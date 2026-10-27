/**
 * 系统状态总账（F1）
 * ---------------------------------------------------------------------------
 * 目的：把散在 6 个载体里的工作状态收敛成一份**只读**视图，回答三个问题：
 *   1. 现在在跑什么？
 *   2. 在等谁拍板？
 *   3. 哪里卡住了？
 *
 * 硬约束（遵守 docs/SYSTEM_FRAMEWORK_v1.0.md）：
 *   - 纯只读。不写任何文件、不改任何业务状态、不触发任何副作用。
 *   - 不改旧表结构。6 套载体原样保留，本模块只在读取时做归一化。
 *   - 不编造。缺失字段一律 null + 说明，绝不用默认值伪装成真实值。
 *   - 无论哪个源坏掉，其余源照常返回，坏掉的源显式标 ok:false + reason。
 */
import { readFile, stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
    STATE_FILE,
    PRODUCT_QUEUE_STATE_FILE,
    DAILY_WAITING_ITEMS_FILE,
    DATA_COLLECTION_TASKS_FILE,
    LISTING_CARDS_FILE,
    HIDDEN_DATA_DIR,
} from "./config.js";
import path from "node:path";

export const SYSTEM_STATE_SCHEMA = "system-state/v1";

/** 统一 7 态。任何载体都必须映射到这 7 个里，不允许新增临时态。 */
export const UNIT_STATES = [
    "DRAFT",
    "READY",
    "RUNNING",
    "BLOCKED_NEEDS_HUMAN",
    "DONE",
    "FAILED",
    "CANCELLED",
];

/** 阈值。全部是"多久算不对劲"，不是"多久算正常"。 */
const THRESHOLDS = {
    // running 单元超过该时长没有任何状态更新 → 判为僵尸（进程被杀但状态没落盘）
    zombieRunningMs: 5 * 60 * 1000,
    // 阻塞超过该时长 → 进入"催办"清单
    stalledBlockedMs: 24 * 60 * 60 * 1000,
    // 已结束且超过该时长 → 归入归档，默认不进活跃视图
    // （否则几个月前的测试数据会淹没真正需要处理的事）
    archivedAfterMs: 7 * 24 * 60 * 60 * 1000,
    // 失败用更长的归档期：失败的批次需要人决策（重试或显式放弃），
    // 不能因为"时间久了"就自动从视野里消失。归档不等于已处理。
    failedArchiveAfterMs: 30 * 24 * 60 * 60 * 1000,
};

// ── 基础工具 ────────────────────────────────────────────────────────────────

async function readJsonSafe(filePath) {
    try {
        const st = await stat(filePath);
        const text = await readFile(filePath, "utf8");
        return { ok: true, data: JSON.parse(text), mtimeMs: st.mtimeMs, bytes: st.size };
    } catch (error) {
        const code = error && error.code ? error.code : "READ_ERROR";
        return { ok: false, error: code === "ENOENT" ? "FILE_NOT_FOUND" : String(error.message || error).slice(0, 160), mtimeMs: null, bytes: null };
    }
}

function num(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoOrNull(value) {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function ageMs(iso) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? null : Date.now() - t;
}

/** 建一个字段齐全的 WorkUnit。缺的填 null，不用默认值糊过去。 */
function mkUnit(input) {
    return {
        unitId: input.unitId,
        kind: input.kind,
        goal: input.goal ?? null,
        state: UNIT_STATES.includes(input.state) ? input.state : "READY",
        stateBasis: input.stateBasis ?? null,
        stage: input.stage ?? null,
        stageIndex: null,
        stageTotal: null,
        progress: num(input.progress),
        blocked: input.blocked ?? null,
        payload: input.payload ?? null,
        artifacts: input.artifacts ?? [],
        metrics: input.metrics ?? {},
        idempotencyKey: input.idempotencyKey ?? null,
        createdBy: input.createdBy ?? null,
        createdAt: isoOrNull(input.createdAt),
        updatedAt: isoOrNull(input.updatedAt),
        finishedAt: isoOrNull(input.finishedAt),
        sourceId: input.sourceId,
        sourceKind: input.sourceKind,
        anomalies: input.anomalies ?? [],
    };
}

function sourceEntry(id, label, filePath, read) {
    return {
        id,
        label,
        path: filePath,
        ok: read.ok,
        error: read.ok ? null : read.error,
        bytes: read.ok ? read.bytes : null,
        updatedAt: read.ok && read.mtimeMs ? new Date(read.mtimeMs).toISOString() : null,
        ageMs: read.ok && read.mtimeMs ? Date.now() - read.mtimeMs : null,
    };
}

// ── 适配器 1：单品 Listing 流水线（run-state.json，单例） ────────────────────

async function adaptRunState() {
    const read = await readJsonSafe(STATE_FILE);
    const source = sourceEntry("run_state", "单品 Listing 流水线", STATE_FILE, read);
    if (!read.ok) return { units: [], source, anomalies: [] };

    const raw = read.data || {};
    const stage = typeof raw.stage === "string" ? raw.stage : null;
    const running = raw.running === true;
    const pauseRequested = raw.pauseRequested === true;

    // 判定依据显式记录，避免"看起来对其实在猜"
    let state = "READY";
    let basis = "stage 未命中终态且 running=false";
    if (stage && /DONE|COMPLETE|FINISH/i.test(stage)) {
        state = "DONE";
        basis = `stage=${stage} 命中完成态`;
    } else if (stage && /FAIL|ERROR/i.test(stage)) {
        state = "FAILED";
        basis = `stage=${stage} 命中失败态`;
    } else if (pauseRequested) {
        state = "BLOCKED_NEEDS_HUMAN";
        basis = "pauseRequested=true";
    } else if (running) {
        state = "RUNNING";
        basis = "running=true";
    } else if (stage && /^READY/i.test(stage)) {
        // 就绪待启动态（READY_FOR_LOGIN / READY_FOR_*）不等于阻塞：
        // 它的语义是"前置已满足，等有人点开始"。曾因 /LOGIN/i 命中把
        // READY_FOR_LOGIN 判成 BLOCKED_NEEDS_HUMAN，产生挂了 19.9h 的假 Gate。
        // 例外：message 明确在要登录/验证时，仍算阻塞（不要用假就绪盖住真阻塞）。
        const msg = String(raw.message || "");
        if (/未登录|需要登录|请登录|登录失效|重新登录|人机验证|验证码/.test(msg)) {
            state = "BLOCKED_NEEDS_HUMAN";
            basis = `stage=${stage} 且 message 提示需登录：${msg.slice(0, 40)}`;
        } else {
            state = "READY";
            basis = `stage=${stage} 为就绪待启动态，非阻塞`;
        }
    } else if (stage && /LOGIN/i.test(stage)) {
        state = "BLOCKED_NEEDS_HUMAN";
        basis = `stage=${stage} 需要人工登录`;
    }

    const updatedAt = isoOrNull(raw.updatedAt);
    const unit = mkUnit({
        unitId: "run:current",
        kind: "LISTING_PIPELINE",
        goal: raw.standardWorkflowGoal
            ? `单品 Listing 流水线（${raw.standardWorkflowGoal}）`
            : raw.objectiveInfo?.goal || "单品 Listing 流水线",
        state,
        stateBasis: basis,
        stage,
        progress: null,
        // 框架要求：BLOCKED 状态必须能说出"在等什么、等多久"，不允许空阻塞
        blocked: state === "BLOCKED_NEEDS_HUMAN"
            ? {
                reason: pauseRequested ? "用户已暂停" : `等待人工处理（stage=${stage}）`,
                since: updatedAt,
                needFrom: "human",
            }
            : null,
        payload: {
            workflowMode: raw.workflowMode ?? null,
            provider: raw.provider ?? null,
            imageCount: num(raw.imageCount),
            skipResearch: raw.skipResearch ?? null,
            skipProductFacts: raw.skipProductFacts ?? null,
        },
        artifacts: Array.isArray(raw.imageNames) ? raw.imageNames.map((n) => ({ type: "image", ref: n })) : [],
        metrics: { imageCount: num(raw.imageCount) },
        createdAt: updatedAt,
        updatedAt,
        sourceId: "run_state",
        sourceKind: "json_singleton",
    });

    // 僵尸运行检测统一在主入口做（对全部载体生效），此处不再重复
    return { units: [unit], source, anomalies: [] };
}

// ── 适配器 2/3：批量上架 / 采集箱批量（同构 JSON） ──────────────────────────

function adaptBatchLike(raw, meta) {
    const running = raw.running === true;
    const progress = num(raw.overallProgress);
    const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : {};
    const success = num(summary.success) ?? 0;
    const failed = num(summary.failed) ?? 0;
    const skipped = num(summary.skipped) ?? 0;
    const total = num(summary.total);

    let state = "READY";
    let basis = "未在运行且进度未满";
    if (running) {
        state = "RUNNING";
        basis = "running=true";
    } else if (progress !== null && progress >= 100) {
        if (failed > 0 && success === 0) {
            state = "FAILED";
            basis = `进度 100% 但 success=0 / failed=${failed}`;
        } else {
            state = "DONE";
            basis = `进度 100%（success=${success} failed=${failed} skipped=${skipped}）`;
        }
    }

    const startedAt = num(raw.startedAt);
    const finishedAt = num(raw.finishedAt);
    const unit = mkUnit({
        unitId: raw.jobId || `${meta.sourceId}:latest`,
        kind: meta.kind,
        goal: meta.label,
        state,
        stateBasis: basis,
        stage: running ? "执行中" : progress !== null && progress >= 100 ? "已结束" : "待开始",
        // progress 契约：统一为 0–100 的百分比（不是 0–1 的比值）。
        // 曾在此处误除 100，导致同一份响应里 run_state 与 batch 量纲不一致，
        // 前端把 100% 渲染成 "1%"。量纲必须单一，否则读的人一定会误解。
        progress: progress,
        payload: { lastOperationId: raw.lastOperationId ?? null },
        metrics: { total, success, failed, skipped, itemCount: Array.isArray(raw.items) ? raw.items.length : null },
        createdAt: startedAt ? new Date(startedAt).toISOString() : null,
        updatedAt: finishedAt ? new Date(finishedAt).toISOString() : startedAt ? new Date(startedAt).toISOString() : null,
        finishedAt: finishedAt ? new Date(finishedAt).toISOString() : null,
        sourceId: meta.sourceId,
        sourceKind: "json_job",
    });

    const anomalies = [];
    if (state === "DONE" && failed > 0) {
        anomalies.push({
            code: "PARTIAL_FAILURE",
            unitId: unit.unitId,
            severity: "P2",
            message: `批次已结束，但有 ${failed} 行失败（成功 ${success} / 跳过 ${skipped}）。失败行需要重试或人工确认。`,
            evidence: { summary },
        });
    }

    return { unit, anomalies };
}

async function adaptBatchListing() {
    const file = path.join(HIDDEN_DATA_DIR, "batch-listing-state.json");
    const read = await readJsonSafe(file);
    const source = sourceEntry("batch_listing", "店小秘批量上架", file, read);
    if (!read.ok) return { units: [], source, anomalies: [] };
    if (!read.data || !read.data.jobId) return { units: [], source, anomalies: [] };
    const { unit, anomalies } = adaptBatchLike(read.data, {
        sourceId: "batch_listing",
        kind: "BATCH_UPLOAD",
        label: "店小秘批量上架",
    });
    return { units: [unit], source, anomalies };
}

async function adaptCollectBatch() {
    const file = path.join(HIDDEN_DATA_DIR, "collect-batch-state.json");
    const read = await readJsonSafe(file);
    const source = sourceEntry("collect_batch", "采集箱批量上架", file, read);
    if (!read.ok) return { units: [], source, anomalies: [] };
    if (!read.data || !read.data.jobId) return { units: [], source, anomalies: [] };
    const { unit, anomalies } = adaptBatchLike(read.data, {
        sourceId: "collect_batch",
        kind: "COLLECT_UPLOAD",
        label: "采集箱批量上架",
    });
    return { units: [unit], source, anomalies };
}

async function adaptProductQueue() {
    const read = await readJsonSafe(PRODUCT_QUEUE_STATE_FILE);
    const source = sourceEntry("product_queue", "商品队列", PRODUCT_QUEUE_STATE_FILE, read);
    if (!read.ok) return { units: [], source, anomalies: [] };
    const raw = read.data || {};
    const tasks = Array.isArray(raw.tasks) ? raw.tasks : Array.isArray(raw.pending) ? raw.pending : null;
    // 空队列不生成工作单元：tasks=[] 的空壳不是"待开始的任务"，是"没有任务"。
    // 否则总账会长期挂一个假 READY，让"待处理"数字失真。
    if (raw.running !== true && (tasks === null || tasks.length === 0)) {
        return { units: [], source, anomalies: [] };
    }
    const pending = tasks ? tasks.length : null;
    const unit = mkUnit({
        unitId: raw.jobId || "queue:current",
        kind: "PRODUCT_QUEUE",
        goal: "商品队列推进",
        state: raw.running === true ? "RUNNING" : "READY",
        stateBasis: raw.running === true ? "running=true" : "队列存在但未运行",
        stage: raw.running === true ? "执行中" : "待开始",
        progress: num(raw.overallProgress),
        metrics: { pending },
        updatedAt: isoOrNull(raw.updatedAt || raw.finishedAt || raw.startedAt),
        sourceId: "product_queue",
        sourceKind: "json_job",
    });
    return { units: [unit], source, anomalies: [] };
}

// ── 适配器 4：包包挂件 Listing 工作台（SQLite，唯一带事件流的载体） ──────────

/** 原始 status → 统一 7 态。映射表显式写出，不做模糊匹配。 */
const CHARM_STATUS_MAP = {
    QUEUED: "READY",
    RUNNING: "RUNNING",
    GENERATING: "RUNNING",
    PUBLISHING: "RUNNING",
    NEEDS_INPUT: "BLOCKED_NEEDS_HUMAN",
    REVIEW_REQUIRED: "BLOCKED_NEEDS_HUMAN",
    PUBLISHED: "DONE",
    DONE: "DONE",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
};

/** status 与 stage 的期望搭配。不匹配即视为状态机不一致（多为中断残留）。 */
const CHARM_EXPECTED_STAGES = {
    NEEDS_INPUT: ["FACTS_CHECK", "INPUT_NEEDED"],
    REVIEW_REQUIRED: ["FINAL_REVIEW"],
    PUBLISHED: ["PUBLISHED", "DONE"],
};

function adaptCharmJobs() {
    const dbPath = path.join(HIDDEN_DATA_DIR, "charm-listing-workspace.sqlite");
    const source = { id: "charm_jobs", label: "包包挂件 Listing 工作台（SQLite）", path: dbPath, ok: true, error: null, bytes: null, updatedAt: null, ageMs: null };
    try {
        // WAL 模式下主 db 文件可能长期不更新，真实写入在 -wal 里，必须取两者较新的
        let mtimeMs = 0;
        let totalBytes = 0;
        for (const f of [dbPath, `${dbPath}-wal`]) {
            try {
                const st = statSync(f);
                mtimeMs = Math.max(mtimeMs, st.mtimeMs);
                totalBytes += st.size;
            } catch (_) { /* 单个文件缺失不影响 */ }
        }
        if (mtimeMs > 0) {
            source.bytes = totalBytes;
            source.updatedAt = new Date(mtimeMs).toISOString();
            source.ageMs = Date.now() - mtimeMs;
        }
    } catch (_) { /* 统计失败不影响读取 */ }
    let db = null;
    try {
        db = new DatabaseSync(dbPath);
        const rows = db.prepare(
            `SELECT j.id, j.product_id, j.status, j.current_stage, j.checkpoint_json, j.created_at, j.updated_at,
                    p.name AS product_name
             FROM charm_listing_jobs j
             LEFT JOIN charm_products p ON p.id = j.product_id
             ORDER BY j.updated_at DESC LIMIT 200`
        ).all();
        const evtStmt = db.prepare(`SELECT type, created_at FROM charm_events WHERE job_id = ? ORDER BY id DESC LIMIT 5`);
        const units = [];
        const anomalies = [];
        for (const row of rows) {
            const state = CHARM_STATUS_MAP[row.status] || "READY";
            const expected = CHARM_EXPECTED_STAGES[row.status];
            const stageMatches = !expected || expected.includes(row.current_stage);
            if (!stageMatches) {
                anomalies.push({
                    code: "STATE_STAGE_CONFLICT",
                    unitId: row.id,
                    severity: "P1",
                    message: `status=${row.status} 但停在 stage=${row.current_stage}（期望 ${expected.join("/")}）。通常是中断后状态未回退，属于"假运行/假待审"。`,
                    evidence: { status: row.status, stage: row.current_stage, updatedAt: row.updated_at },
                });
            }
            let events = [];
            try {
                events = evtStmt.all(row.id).map((e) => ({ type: e.type, at: e.created_at }));
            } catch (_) { /* 事件表缺失不算致命 */ }
            let checkpoint = null;
            try { checkpoint = JSON.parse(row.checkpoint_json || "null"); } catch (_) { checkpoint = null; }

            const blocked = state === "BLOCKED_NEEDS_HUMAN"
                ? { reason: row.current_stage || row.status, since: isoOrNull(row.updated_at), needFrom: "human" }
                : null;

            units.push(mkUnit({
                unitId: row.id,
                kind: "LISTING",
                goal: row.product_name ? `${row.product_name} · Listing` : `商品 ${row.product_id} 的 Listing`,
                state,
                stateBasis: `原始 status=${row.status}`,
                stage: row.current_stage,
                progress: null,
                blocked,
                payload: { productId: row.product_id, checkpoint },
                artifacts: [],
                metrics: { eventCount: events.length },
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                sourceId: "charm_jobs",
                sourceKind: "sqlite",
            }));
        }
        return { units, source, anomalies };
    } catch (error) {
        source.ok = false;
        source.error = String(error.message || error).slice(0, 160);
        return { units: [], source, anomalies: [] };
    } finally {
        try { db?.close(); } catch (_) { /* 忽略关闭异常 */ }
    }
}

// ── 适配器 5：数据采集任务 ─────────────────────────────────────────────────

async function adaptDataCollectionTasks() {
    const read = await readJsonSafe(DATA_COLLECTION_TASKS_FILE);
    const source = sourceEntry("data_collection", "经营数据采集任务", DATA_COLLECTION_TASKS_FILE, read);
    if (!read.ok) return { units: [], source, anomalies: [] };
    const list = Array.isArray(read.data) ? read.data : [];
    const map = { pending: "READY", running: "RUNNING", analyzed: "DONE", failed: "FAILED", cancelled: "CANCELLED" };
    const units = list.map((t) => mkUnit({
        unitId: t.task_id || "unknown",
        kind: "DATA_COLLECTION",
        goal: `采集 ${t.platform_product_id || "-"} / ${t.platform_sku_id || "-"} 的${t.period || ""}数据`,
        state: map[String(t.status || "").toLowerCase()] || "READY",
        stateBasis: `原始 status=${t.status}`,
        stage: t.status ?? null,
        progress: null,
        payload: { period: t.period ?? null, reviewDueAt: t.review_due_at ?? null },
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        sourceId: "data_collection",
        sourceKind: "json_list",
    }));
    return { units, source, anomalies: [] };
}

// ── 适配器 6：每日待办（等外部方，不是等自己人） ────────────────────────────

async function adaptDailyWaiting() {
    const read = await readJsonSafe(DAILY_WAITING_ITEMS_FILE);
    const source = sourceEntry("daily_waiting", "每日待办（等外部方）", DAILY_WAITING_ITEMS_FILE, read);
    if (!read.ok) return { units: [], source, anomalies: [] };
    const list = Array.isArray(read.data?.items) ? read.data.items : [];
    const map = { resolved: "DONE", cancelled: "CANCELLED", open: "BLOCKED_NEEDS_HUMAN", waiting: "BLOCKED_NEEDS_HUMAN" };
    const units = list.map((it) => {
        const state = map[String(it.status || "").toLowerCase()] || "BLOCKED_NEEDS_HUMAN";
        return mkUnit({
            unitId: it.waiting_id || "unknown",
            kind: "EXTERNAL_WAIT",
            goal: it.description || "待办",
            state,
            stateBasis: `原始 status=${it.status}`,
            stage: it.waiting_type ?? null,
            progress: null,
            blocked: state === "BLOCKED_NEEDS_HUMAN"
                ? { reason: it.description || "等待外部方", since: isoOrNull(it.created_at), needFrom: it.owner_role || it.owner || "external" }
                : null,
            payload: { storeName: it.store_name ?? null, owner: it.owner ?? null, dueAt: it.due_at ?? null },
            createdAt: it.created_at,
            updatedAt: it.resolved_at || it.created_at,
            finishedAt: it.resolved_at || null,
            sourceId: "daily_waiting",
            sourceKind: "json_list",
        });
    });
    return { units, source, anomalies: [] };
}

// ── 对象摘要（不是工作单元，只做计数，供上层拼仪表盘） ──────────────────────

async function summarizeObjects() {
    const read = await readJsonSafe(LISTING_CARDS_FILE);
    if (!read.ok) return { listings: { ok: false, error: read.error } };
    const cards = Array.isArray(read.data) ? read.data : [];
    const byStatus = {};
    const byLifecycle = {};
    for (const c of cards) {
        const s = c.listing_status || "UNKNOWN";
        const l = c.listing_lifecycle || "UNKNOWN";
        byStatus[s] = (byStatus[s] || 0) + 1;
        byLifecycle[l] = (byLifecycle[l] || 0) + 1;
    }
    return {
        listings: {
            ok: true,
            total: cards.length,
            byStatus,
            byLifecycle,
            updatedAt: read.mtimeMs ? new Date(read.mtimeMs).toISOString() : null,
            note: "这只是本地登记的在售卡片，不等于平台真实在售数。平台侧口径见 data/metrics。",
        },
    };
}

// ── 主入口 ─────────────────────────────────────────────────────────────────

/**
 * 构建系统状态总账。只读，无副作用。
 * @returns {Promise<object>} 统一状态视图
 */
export async function buildSystemState() {
    const adapters = [
        adaptRunState,
        adaptBatchListing,
        adaptCollectBatch,
        adaptProductQueue,
        adaptCharmJobs,          // 同步函数，await 也安全
        adaptDataCollectionTasks,
        adaptDailyWaiting,
    ];

    const results = await Promise.allSettled(adapters.map((fn) => Promise.resolve().then(fn)));

    const units = [];
    const sources = [];
    const anomalies = [];

    results.forEach((r, i) => {
        if (r.status === "fulfilled") {
            units.push(...(r.value.units || []));
            if (r.value.source) sources.push(r.value.source);
            anomalies.push(...(r.value.anomalies || []));
        } else {
            // 适配器本身抛错：不中断整体，记为源不可读
            sources.push({
                id: `adapter_${i}`,
                label: adapters[i].name,
                path: null,
                ok: false,
                error: String(r.reason?.message || r.reason).slice(0, 160),
                bytes: null,
                updatedAt: null,
                ageMs: null,
            });
            anomalies.push({
                code: "SOURCE_UNREADABLE",
                unitId: null,
                severity: "P2",
                message: `适配器 ${adapters[i].name} 执行失败：${String(r.reason?.message || r.reason).slice(0, 120)}`,
                evidence: null,
            });
        }
    });

    // ── 跨源统一校验 ────────────────────────────────────────────────────────
    // 这三个检查必须在这里做，不能交给各适配器：否则新增一个载体就会漏检一类问题
    for (const u of units) {
        // 1) 僵尸运行：标记 RUNNING 但状态长时间不动 = 进程早没了，只是状态没落盘
        if (u.state === "RUNNING") {
            const age = ageMs(u.updatedAt);
            if (age !== null && age > THRESHOLDS.zombieRunningMs) {
                const hours = age / 3600000;
                const span = hours >= 24 ? `${Math.round(hours / 24)} 天` : `${Math.round(age / 60000)} 分钟`;
                const msg = `标记为运行中，但状态已 ${span} 未更新。实际很可能早已中断，只是状态没回退——典型的"假运行"。`;
                u.anomalies.push({ code: "ZOMBIE_RUNNING", message: msg });
                anomalies.push({
                    code: "ZOMBIE_RUNNING", unitId: u.unitId, severity: "P1", message: msg,
                    evidence: { updatedAt: u.updatedAt, stage: u.stage },
                });
            }
        }
        // 2) 阻塞但说不出在等什么：框架禁止空 Gate
        if (u.state === "BLOCKED_NEEDS_HUMAN" && !u.blocked) {
            u.blocked = { reason: u.stage || "原因未记录", since: u.updatedAt, needFrom: "human", inferred: true };
            const msg = `状态为等待人工，但没有记录等待原因与等待对象（已按 stage 兜底推断）。这是 Gate 未统一的历史遗留。`;
            u.anomalies.push({ code: "BLOCKED_WITHOUT_GATE", message: msg });
            anomalies.push({
                code: "BLOCKED_WITHOUT_GATE", unitId: u.unitId, severity: "P2", message: msg,
                evidence: { stage: u.stage },
            });
        }
        // 3) 阻塞超期：需要处理，或者显式关闭
        if (u.state === "BLOCKED_NEEDS_HUMAN" && u.blocked?.since) {
            const age = ageMs(u.blocked.since);
            if (age !== null && age > THRESHOLDS.stalledBlockedMs) {
                const msg = `已阻塞等待 ${Math.round(age / 3600000)} 小时（阈值 ${THRESHOLDS.stalledBlockedMs / 3600000} 小时），需要处理或显式关闭。`;
                u.anomalies.push({ code: "STALLED_BLOCKED", message: msg });
                anomalies.push({
                    code: "STALLED_BLOCKED", unitId: u.unitId, severity: "P2", message: msg,
                    evidence: { since: u.blocked.since, stage: u.stage },
                });
            }
        }
    }

    // ── 活跃 / 归档分离 ─────────────────────────────────────────────────────
    // 已结束且超过归档期的不进活跃视图：否则几个月前的测试数据会把真问题淹没
    for (const u of units) {
        const settled = u.state === "DONE" || u.state === "CANCELLED";
        const failed = u.state === "FAILED";
        const age = ageMs(u.updatedAt || u.finishedAt);
        const limit = failed ? THRESHOLDS.failedArchiveAfterMs : THRESHOLDS.archivedAfterMs;
        u.archived = (settled || failed) && age !== null && age > limit;
    }
    const activeUnits = units.filter((u) => !u.archived);
    const archivedUnits = units.filter((u) => u.archived);
    const activeIds = new Set(activeUnits.map((u) => u.unitId));
    const activeAnomalies = anomalies.filter((a) => !a.unitId || activeIds.has(a.unitId));

    const byState = {};
    for (const s of UNIT_STATES) byState[s] = 0;
    for (const u of activeUnits) byState[u.state] = (byState[u.state] || 0) + 1;

    const gates = activeUnits
        .filter((u) => u.state === "BLOCKED_NEEDS_HUMAN")
        .map((u) => ({
            gateId: `gate:${u.unitId}`,
            unitId: u.unitId,
            kind: u.kind,
            question: u.goal || u.blocked?.reason || "需要人工处理",
            reason: u.blocked?.reason ?? null,
            needFrom: u.blocked?.needFrom ?? "human",
            blockedSince: u.blocked?.since ?? null,
            blockedForMs: ageMs(u.blocked?.since),
            // 按框架红线：超时绝不自动通过，只会停在这里
            defaultIfIgnored: "stall",
        }));

    const objects = await summarizeObjects();

    return {
        schema: SYSTEM_STATE_SCHEMA,
        generatedAt: new Date().toISOString(),
        readOnly: true,
        thresholds: THRESHOLDS,
        summary: {
            unitCount: activeUnits.length,
            archivedCount: archivedUnits.length,
            byState,
            gateCount: gates.length,
            anomalyCount: activeAnomalies.length,
            attentionRequired: gates.length + activeAnomalies.filter((a) => a.severity === "P0" || a.severity === "P1").length,
            healthy: gates.length === 0 && activeAnomalies.length === 0,
        },
        gates,
        units: activeUnits,
        // 归档只给索引，不展开内容：它们不需要被处理，只需要能被追溯
        archived: archivedUnits.map((u) => ({ unitId: u.unitId, kind: u.kind, state: u.state, updatedAt: u.updatedAt })),
        anomalies: activeAnomalies,
        objects,
        sources,
        caveats: [
            "本视图只归一化读取，不改变任何业务状态；6 套原始载体保持独立，未合并存储。",
            "progress 为 null 表示该载体本身不提供进度，不是进度为 0；有值时统一为 0–100 的百分比，全响应单一量纲。",
            "已结束且超过 7 天的单元归入 archived，不进活跃视图与 gates；需要历史时看 archived 索引。",
            "listing 计数来自本地登记卡片，不代表平台真实在售数。",
            "本接口不判断数据新鲜度是否足以支撑决策，那是 L4 决策层的职责。",
        ],
    };
}

export default { buildSystemState, SYSTEM_STATE_SCHEMA, UNIT_STATES };
