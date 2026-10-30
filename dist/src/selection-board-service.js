/**
 * 选品看板（Selection Board）—— 产品发现与任务看板的唯一事实来源。
 *
 * Phase 1（YKB-V1-PHASE1-IDENTITY-STATE-20261030-R1 / E 状态拆分）改造要点：
 *
 *   **一套 status 拆成三套互不覆盖的状态**
 *     1. development_stage        产品开发阶段（Product 粒度）
 *     2. dianxiaomi_sync_status   店小秘同步状态（Product / Listing 版本粒度）
 *     3. storeListings[]          逐店刊登状态（Product × Store 粒度）
 *
 *   旧前端仍在读 `status`（七态）——那是**派生只读字段**，由上面三套计算得出，
 *   不落盘。写 `status` 时按 LEGACY_STATUS_TO_STATE 反查映射到新字段，
 *   所以旧客户端不会崩，也不会写坏新模型。
 *
 *   核心不变量（照抄基线 §03.6）：
 *     - LISTING_READY ≠ SYNCED，SYNCED ≠ PUBLISHED；
 *     - 店铺 A 的失败不影响店铺 B；
 *     - 同步成功绝不自动把任何店铺标为 PUBLISHED；
 *     - 无计划店铺可以制作 Listing，但没有已核验店铺计划不得发布。
 *
 * 其他 Phase 1 修复：
 *   - `images[].sourceUrl` 保留用户原始 URL（原来恒为空字符串，是 bug）；
 *   - 图片分 MAIN / ADDITIONAL，风格图 assetType=STYLE_REFERENCE 且独立目录；
 *   - 推送上品带幂等键，重复点击不产生第二次副作用记录。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
    SELECTION_BOARD_DIR,
    SELECTION_BOARD_FILE,
    SELECTION_BOARD_IMAGES_DIR,
    SELECTION_BOARD_STYLE_DIR
} from "./config.js";
import { importImagesToDirectory, scanImages } from "./directory-images.js";
import {
    clearProductImages,
    detectImageExtension,
    downloadPublicImage,
    importProductImages,
    isSupportedImage
} from "./image-files.js";
import { clearStyleReferenceImages, importStyleReferenceImages, invalidateStyleLock } from "./style-reference-service.js";

/* ══ 一、产品开发阶段（development_stage）══
   语义见基线 §03.1。LISTING_READY 只代表内容+素材过 QC，
   不代表店小秘已保存，更不代表平台已发布。 */
export const DEVELOPMENT_STAGES = [
    { id: "DISCOVERED", label: "已发现", tone: "neutral", hint: "刚录入，尚未开始填资料" },
    { id: "DATA_ENTRY", label: "资料录入", tone: "neutral", hint: "补产品图与客观信息" },
    { id: "READY_FOR_LISTING", label: "待制作 Listing", tone: "info", hint: "名称 / 主图 / 模板齐备，可启动 Listing" },
    { id: "LISTING_IN_PROGRESS", label: "Listing 制作中", tone: "active", hint: "已推送到上品流程" },
    { id: "QC_PENDING", label: "待质检", tone: "active", hint: "Listing 产出待验收" },
    { id: "QC_PASSED", label: "质检通过", tone: "good", hint: "资产通过验收，尚未标记 Listing 就绪" },
    { id: "LISTING_READY", label: "Listing 就绪", tone: "good", hint: "内容与素材过 QC；不代表已同步店小秘或已发布" },
    { id: "BLOCKED_INPUT", label: "资料阻塞", tone: "warn", hint: "必要资料缺失" },
    { id: "PAUSED", label: "已暂停", tone: "warn", hint: "人工挂起" },
    { id: "REJECTED", label: "已终止", tone: "muted", hint: "人工决定不做" },
    { id: "ARCHIVED", label: "已归档", tone: "muted", hint: "结束归档" }
];

/* ══ 二、店小秘同步状态（dianxiaomi_sync_status）══
   SYNCED 只表示"店小秘侧可核验保存回执"，与平台刊登完全无关。 */
export const DIANXIAOMI_SYNC_STATUSES = [
    { id: "NOT_STARTED", label: "未开始", tone: "neutral" },
    { id: "READY_TO_SYNC", label: "待同步", tone: "info" },
    { id: "SYNCING", label: "同步中", tone: "active" },
    { id: "SYNCED", label: "已保存到店小秘", tone: "good" },
    { id: "SYNC_FAILED", label: "同步失败", tone: "warn" },
    { id: "RETRY_PENDING", label: "待重试", tone: "warn" },
    { id: "NEEDS_MANUAL_REVIEW", label: "需人工处理", tone: "warn" },
    { id: "NOT_REQUIRED", label: "无需同步", tone: "muted" }
];

/* ══ 三、逐店刊登状态（store_listing_status）══
   每个 store_id 一条独立记录；一个店铺失败不影响其他店铺。 */
export const STORE_LISTING_STATUSES = [
    { id: "PLANNED", label: "已计划", tone: "neutral" },
    { id: "CONTENT_PREPARING", label: "刊登包准备中", tone: "active" },
    { id: "PENDING_HUMAN_APPROVAL", label: "待人工批准", tone: "info" },
    { id: "APPROVED_TO_PUBLISH", label: "已批准待提交", tone: "info" },
    { id: "SUBMITTING", label: "提交中", tone: "active" },
    { id: "PUBLISHED", label: "已发布", tone: "good" },
    { id: "FAILED", label: "发布失败", tone: "warn" },
    { id: "RETRY_PENDING", label: "待重试", tone: "warn" },
    { id: "PAUSED", label: "已暂停", tone: "warn" },
    { id: "DELISTED", label: "已下架", tone: "muted" }
];

/* ══ 旧七态 → 新三状态映射（E. 输出旧状态 → 新状态映射表）══
   这张表是唯一权威；改动必须走变更记录（基线 §12）。 */
export const LEGACY_STATUS_TO_STATE = Object.freeze({
    PICKED: {
        development_stage: "DATA_ENTRY",
        dianxiaomi_sync_status: "NOT_STARTED",
        note: "旧「已选品」= 资料录入中，尚未推送"
    },
    READY: {
        development_stage: "READY_FOR_LISTING",
        dianxiaomi_sync_status: "NOT_STARTED",
        note: "旧「待上架」= 素材齐备可启动 Listing；注意旧名有歧义，此时并未上架"
    },
    LISTING: {
        development_stage: "LISTING_IN_PROGRESS",
        dianxiaomi_sync_status: "NOT_STARTED",
        note: "旧「Listing 制作中」"
    },
    LISTING_DONE: {
        development_stage: "LISTING_READY",
        dianxiaomi_sync_status: "NOT_STARTED",
        note: "旧「清单已完成」= 内容与素材产出；**不含**店小秘是否保存"
    },
    SAVED_DXM: {
        development_stage: "LISTING_READY",
        dianxiaomi_sync_status: "SYNCED",
        note: "旧「店小秘已保存」被拆开：开发阶段仍是 LISTING_READY，同步状态才是 SYNCED。这是本次拆分的核心一笔。"
    },
    ON_HOLD: {
        development_stage: "PAUSED",
        dianxiaomi_sync_status: "NOT_STARTED",
        note: "旧「暂缓」→ 开发阶段 PAUSED（同步状态保留原值，不重置）"
    },
    DROPPED: {
        development_stage: "REJECTED",
        dianxiaomi_sync_status: "NOT_STARTED",
        note: "旧「已放弃」→ 开发阶段 REJECTED（同步状态保留原值）"
    }
});

/* 新三状态 → 旧七态（供旧前端读取，纯派生） */
function deriveLegacyStatus(item) {
    const stage = item.developmentStage;
    const sync = item.dianxiaomiSyncStatus;
    if (stage === "PAUSED") return "ON_HOLD";
    if (stage === "REJECTED" || stage === "ARCHIVED") return "DROPPED";
    if (stage === "LISTING_READY" || stage === "QC_PASSED") {
        return sync === "SYNCED" ? "SAVED_DXM" : "LISTING_DONE";
    }
    if (stage === "LISTING_IN_PROGRESS" || stage === "QC_PENDING") return "LISTING";
    if (stage === "READY_FOR_LISTING") return "READY";
    return "PICKED";
}

const DEV_STAGE_IDS = new Set(DEVELOPMENT_STAGES.map((stage) => stage.id));
const SYNC_IDS = new Set(DIANXIAOMI_SYNC_STATUSES.map((status) => status.id));
const STORE_LISTING_IDS = new Set(STORE_LISTING_STATUSES.map((status) => status.id));
const LEGACY_STATUS_IDS = new Set(Object.keys(LEGACY_STATUS_TO_STATE));

const MAX_IMAGES = 12;
const MAX_STYLE_REFS = 3;

const nowIso = () => new Date().toISOString();

function initialBoard() {
    const now = nowIso();
    return {
        schemaVersion: "2.0",
        schemaNote:
            "2.0 = Phase1 三状态拆分（developmentStage / dianxiaomiSyncStatus / storeListings）。1.0 的 status 字段读取时自动迁移。",
        items: [],
        createdAt: now,
        updatedAt: now
    };
}

function slug(text, fallback = "product") {
    const cleaned = String(text ?? "")
        .normalize("NFKC")
        .replace(/[\\/:*?"<>|]+/g, " ")
        .replace(/\s+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return cleaned || fallback;
}

function compactText(value, max = 2000) {
    if (value === undefined || value === null) return "";
    return String(value).slice(0, max);
}

/** SKU 表格回填：接受二维数组、对象数组或原始文本（TSV/CSV），统一成 {columns, rows}。 */
export function normalizeSkuTable(input) {
    if (!input || typeof input !== "object") return undefined;
    const capturedAt = input.capturedAt ? String(input.capturedAt) : nowIso();
    const source = compactText(input.source ?? "manual", 40) || "manual";
    let columns = Array.isArray(input.columns) ? input.columns.map((c) => compactText(c, 80)) : [];
    let rows = [];

    if (Array.isArray(input.rows)) {
        rows = input.rows.map((row) => {
            if (Array.isArray(row)) return row.map((cell) => compactText(cell, 400));
            if (row && typeof row === "object") return Object.values(row).map((cell) => compactText(cell, 400));
            return [compactText(row, 400)];
        });
        if (!columns.length && input.rows[0] && typeof input.rows[0] === "object" && !Array.isArray(input.rows[0])) {
            columns = Object.keys(input.rows[0]).map((key) => compactText(key, 80));
        }
    } else if (typeof input.text === "string" && input.text.trim()) {
        const lines = input.text.replace(/\r/g, "").split("\n").filter((line) => line.trim());
        const separator = lines.some((line) => line.includes("\t")) ? "\t" : ",";
        const cells = lines.map((line) =>
            line.split(separator).map((cell) => compactText(cell.trim().replace(/^"|"$/g, ""), 400))
        );
        if (cells.length) {
            columns = cells[0];
            rows = cells.slice(1);
        }
    }

    if (!rows.length && !columns.length) {
        return { capturedAt, source, columns: [], rows: [], note: compactText(input.note, 400) };
    }
    return {
        capturedAt,
        source,
        columns,
        rows: rows.slice(0, 500),
        note: compactText(input.note, 400)
    };
}

export class SelectionBoardService {
    board = initialBoard();
    pending = Promise.resolve();
    boardDir;
    boardFile;
    imagesDir;
    styleDir;

    constructor(options = {}) {
        this.boardDir = options.boardDir ?? SELECTION_BOARD_DIR;
        this.boardFile = options.boardFile ?? SELECTION_BOARD_FILE;
        this.imagesDir = options.imagesDir ?? SELECTION_BOARD_IMAGES_DIR;
        this.styleDir = options.styleDir ?? SELECTION_BOARD_STYLE_DIR;
        // 可注入的图片下载器：生产用 downloadPublicImage（含私网/SSRF 拦截），
        // 测试可注入 stub 以离线验证 sourceUrl 保存链路。
        this.downloadImage = options.downloadImage ?? downloadPublicImage;
    }

    /* ── 串行队列：所有写操作排队，避免并发 HTTP 请求互相覆盖 board.json ── */
    enqueue(operation) {
        const next = this.pending.then(operation);
        this.pending = next.catch(() => undefined);
        return next;
    }

    async load() {
        await Promise.all([
            mkdir(this.boardDir, { recursive: true }),
            mkdir(this.imagesDir, { recursive: true }),
            mkdir(this.styleDir, { recursive: true })
        ]);
        try {
            const raw = JSON.parse(await readFile(this.boardFile, "utf8"));
            this.board = {
                ...initialBoard(),
                ...raw,
                schemaVersion: "2.0",
                items: Array.isArray(raw.items) ? raw.items.map((item) => this.normalizeItem(item)) : []
            };
            // 1.0 → 2.0：确有旧条目被迁移时立即落盘，保证磁盘与内存一致
            const migrated = this.board.items.some((item) => item._migratedFromV1);
            for (const item of this.board.items) delete item._migratedFromV1;
            if (migrated) await this.persist();
        } catch (error) {
            if (error?.code !== "ENOENT") {
                console.warn("[selection-board] board.json 读取失败，从空看板开始:", error?.message ?? error);
            }
            this.board = initialBoard();
            await this.persist();
        }
        return this.snapshot();
    }

    async persist() {
        this.board.updatedAt = nowIso();
        const temp = `${this.boardFile}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(this.board, null, 2), "utf8");
        await rename(temp, this.boardFile);
    }

    /* ══ v1 → v2 迁移：把单一 status 拆成两套产品级状态 + 空的逐店列表 ══
       迁移不删除旧值，写进 legacy 字段供审计。 */
    normalizeItem(item) {
        let developmentStage = compactText(item.developmentStage, 40).toUpperCase();
        let syncStatus = compactText(item.dianxiaomiSyncStatus, 40).toUpperCase();
        let migrated = false;

        if (!DEV_STAGE_IDS.has(developmentStage)) {
            const legacy = compactText(item.status, 40).toUpperCase();
            const mapped = LEGACY_STATUS_TO_STATE[legacy];
            if (mapped) {
                developmentStage = mapped.development_stage;
                if (!SYNC_IDS.has(syncStatus)) syncStatus = mapped.dianxiaomi_sync_status;
                migrated = true;
            } else if (legacy) {
                // 未知旧状态：不猜。落到 DATA_ENTRY 但留痕，等人工处理
                developmentStage = "DATA_ENTRY";
                migrated = true;
            } else {
                developmentStage = "DATA_ENTRY";
            }
        }
        if (!SYNC_IDS.has(syncStatus)) syncStatus = "NOT_STARTED";

        return {
            id: String(item.id ?? `sb_${randomUUID().slice(0, 8)}`),
            seq: Number.isFinite(item.seq) ? item.seq : 0,
            name: compactText(item.name, 200) || "未命名候选",

            /* ── 三套独立状态 ── */
            developmentStage,
            dianxiaomiSyncStatus: syncStatus,
            storeListings: Array.isArray(item.storeListings)
                ? item.storeListings.map((entry) => this.normalizeStoreListing(entry)).filter(Boolean)
                : [],
            plannedStoreIds: Array.isArray(item.plannedStoreIds)
                ? item.plannedStoreIds.map((id) => compactText(id, 80)).filter(Boolean)
                : [],

            /* ── 旧字段：只保留原值做审计，不再作为写入口 ── */
            legacyStatus: compactText(item.legacyStatus ?? item.status, 40) || null,
            legacyStatusMigrationNote: migrated
                ? (LEGACY_STATUS_TO_STATE[compactText(item.status, 40).toUpperCase()]?.note ??
                  "未知旧状态，已落 DATA_ENTRY 待人工确认")
                : undefined,

            sourceUrl: compactText(item.sourceUrl, 2000),
            sourcePlatform: compactText(item.sourcePlatform, 60),
            sourceNote: compactText(item.sourceNote, 400),
            objectiveInfo: compactText(item.objectiveInfo, 4000),
            notes: compactText(item.notes, 2000),
            // 规范 Product 身份：由 Phase1 身份注册入口发放；未接入前为 null
            productId: compactText(item.productId, 80) || null,
            listingTemplateRef: compactText(item.listingTemplateRef, 200) || null,
            templateSnapshotId: compactText(item.templateSnapshotId, 80) || null,

            images: Array.isArray(item.images)
                ? item.images
                      .filter((image) => image && isSupportedImage(String(image.name ?? "")))
                      .map((image, index) => ({
                          name: String(image.name),
                          // 主图/附图/风格图三分类（基线 §02 PRODUCT_IMAGE_ASSET.image_type）
                          assetType: ["MAIN", "ADDITIONAL", "STYLE_REFERENCE"].includes(image.assetType)
                              ? image.assetType
                              : index === 0
                                ? "MAIN"
                                : "ADDITIONAL",
                          origin: image.origin === "url" ? "url" : "upload",
                          // 原始 URL：用户给什么存什么，不规范化、不猜测
                          sourceUrl: compactText(image.sourceUrl, 2000),
                          sourceUrlStatus: compactText(image.sourceUrlStatus, 40) ||
                              (image.sourceUrl ? "RECORDED" : image.origin === "url" ? "MISSING_LEGACY" : "NOT_APPLICABLE"),
                          downloadStatus: compactText(image.downloadStatus, 40) || "OK",
                          addedAt: image.addedAt ?? nowIso()
                      }))
                : [],
            styleRefs: Array.isArray(item.styleRefs)
                ? item.styleRefs
                      .filter((image) => image && isSupportedImage(String(image.name ?? "")))
                      .map((image) => ({
                          name: String(image.name),
                          assetType: "STYLE_REFERENCE",
                          origin: image.origin === "url" ? "url" : "upload",
                          sourceUrl: compactText(image.sourceUrl, 2000),
                          addedAt: image.addedAt ?? nowIso()
                      }))
                : [],
            skuTable: item.skuTable ?? null,
            listing: item.listing ?? null,
            pushIdempotencyKey: compactText(item.pushIdempotencyKey, 80) || null,
            automation: { autoPickup: Boolean(item.automation?.autoPickup) },
            history: Array.isArray(item.history) ? item.history.slice(-120) : [],
            createdAt: item.createdAt ?? nowIso(),
            updatedAt: item.updatedAt ?? nowIso(),
            _migratedFromV1: migrated
        };
    }

    normalizeStoreListing(entry) {
        if (!entry || typeof entry !== "object") return null;
        const storeId = compactText(entry.storeId ?? entry.store_id, 80);
        if (!storeId) return null;
        const status = compactText(entry.status, 40).toUpperCase();
        return {
            storeId,
            externalStoreCode: compactText(entry.externalStoreCode, 80),
            status: STORE_LISTING_IDS.has(status) ? status : "PLANNED",
            listingUrl: compactText(entry.listingUrl, 2000),
            platformListingId: compactText(entry.platformListingId, 200),
            failureReason: compactText(entry.failureReason, 500),
            approvalId: compactText(entry.approvalId, 80),
            publishedAt: entry.publishedAt ?? null,
            updatedAt: entry.updatedAt ?? nowIso(),
            history: Array.isArray(entry.history) ? entry.history.slice(-40) : []
        };
    }

    /* ── 只读视图：附带派生 legacy status、各状态计数与「下一步该做什么」提示 ── */
    snapshot() {
        const items = this.board.items.map((item) => {
            const legacyStatus = deriveLegacyStatus(item);
            return {
                ...item,
                status: legacyStatus, // 派生只读，供旧前端使用
                imageCount: item.images.length,
                styleRefCount: item.styleRefs.length,
                skuRowCount: item.skuTable?.rows?.length ?? 0,
                storeListingCount: item.storeListings.length,
                publishedStoreCount: item.storeListings.filter((entry) => entry.status === "PUBLISHED").length,
                nextAction: this.nextActionFor(item)
            };
        });
        const counts = Object.fromEntries([...LEGACY_STATUS_IDS].map((status) => [status, 0]));
        for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;

        const developmentCounts = Object.fromEntries(DEVELOPMENT_STAGES.map((stage) => [stage.id, 0]));
        for (const item of this.board.items) developmentCounts[item.developmentStage] = (developmentCounts[item.developmentStage] ?? 0) + 1;

        return {
            schemaVersion: this.board.schemaVersion,
            items,
            counts, // 旧前端：七态计数
            developmentCounts, // 新：开发阶段计数
            total: items.length,
            statuses: DEVELOPMENT_STAGES.map((stage) => ({ ...stage, legacyId: this.legacyForStage(stage.id) })),
            legacyStatuses: [...LEGACY_STATUS_IDS].map((id) => ({ id, label: this.legacyLabel(id) })),
            dianxiaomiSyncStatuses: DIANXIAOMI_SYNC_STATUSES,
            storeListingStatuses: STORE_LISTING_STATUSES,
            updatedAt: this.board.updatedAt
        };
    }

    legacyForStage(stageId) {
        return deriveLegacyStatus({ developmentStage: stageId, dianxiaomiSyncStatus: "NOT_STARTED" });
    }

    legacyLabel(statusId) {
        const labels = {
            PICKED: "已选品",
            READY: "待上架",
            LISTING: "Listing 制作中",
            LISTING_DONE: "Listing 已完成",
            SAVED_DXM: "店小秘已保存",
            ON_HOLD: "暂缓",
            DROPPED: "已放弃"
        };
        return labels[statusId] ?? statusId;
    }

    nextActionFor(item) {
        const stage = item.developmentStage;
        if (stage === "ARCHIVED" || stage === "REJECTED") return { key: "none", label: "不推进" };
        if (stage === "PAUSED") return { key: "resume", label: "恢复推进" };
        if (!item.images.length) return { key: "add-images", label: "补产品图" };
        if (!item.objectiveInfo.trim()) return { key: "add-facts", label: "补客观信息" };
        if (stage === "DISCOVERED" || stage === "DATA_ENTRY" || stage === "BLOCKED_INPUT") {
            return { key: "push", label: "推送上品" };
        }
        if (stage === "READY_FOR_LISTING") return { key: "push", label: "推送上品" };
        if (stage === "LISTING_IN_PROGRESS" || stage === "QC_PENDING") return { key: "goto-listing", label: "继续 Listing" };
        if (item.dianxiaomiSyncStatus !== "SYNCED" && item.dianxiaomiSyncStatus !== "NOT_REQUIRED") {
            return { key: "mark-synced", label: "标记已存店小秘" };
        }
        if (!item.storeListings.length) return { key: "plan-store", label: "选择计划店铺" };
        return { key: "none", label: "等待人工审批发布" };
    }

    findItem(id) {
        const item = this.board.items.find((entry) => entry.id === String(id ?? ""));
        if (!item) throw new Error("选品条目不存在（可能已被删除）");
        return item;
    }

    touch(item, note) {
        item.updatedAt = nowIso();
        if (note) item.history.push({ at: item.updatedAt, type: "note", note });
        if (item.history.length > 120) item.history = item.history.slice(-120);
    }

    itemDir(item, kind) {
        const root = kind === "style" ? this.styleDir : this.imagesDir;
        // 目录名固定用 id（已校验为安全字符），不使用用户输入的名称，避免路径穿越
        return path.join(root, item.id);
    }

    async listImages(item, kind) {
        const dir = this.itemDir(item, kind);
        try {
            const images = await scanImages(dir);
            return images.map((image) => ({ name: image.name, size: image.size, path: image.path }));
        } catch {
            return [];
        }
    }

    /** 第一张图自动成为主图（基线 §02：MAIN 固定 1 张，其余 ADDITIONAL）。 */
    nextAssetType(item) {
        return item.images.some((image) => image.assetType === "MAIN" || image.assetType === "ADDITIONAL")
            ? "ADDITIONAL"
            : "MAIN";
    }

    /* ══ 条目 CRUD ══ */
    async createItem(input = {}) {
        return this.enqueue(async () => {
            const name = compactText(input.name, 200).trim();
            const sourceUrl = compactText(input.sourceUrl, 2000).trim();
            if (!name && !sourceUrl) throw new Error("至少需要填写产品名称或来源 URL");

            const stage = compactText(input.developmentStage ?? input.status, 40).toUpperCase();
            let developmentStage = DEV_STAGE_IDS.has(stage) ? stage : null;
            let syncStatus = compactText(input.dianxiaomiSyncStatus, 40).toUpperCase();
            if (!developmentStage) {
                const legacy = LEGACY_STATUS_TO_STATE[stage];
                developmentStage = legacy ? legacy.development_stage : "DATA_ENTRY";
                if (!SYNC_IDS.has(syncStatus) && legacy) syncStatus = legacy.dianxiaomi_sync_status;
            }
            if (!SYNC_IDS.has(syncStatus)) syncStatus = "NOT_STARTED";

            const item = this.normalizeItem({
                id: `sb_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`,
                seq: (this.board.items.reduce((max, entry) => Math.max(max, entry.seq ?? 0), 0) || 0) + 1,
                name: name || sourceUrl,
                developmentStage,
                dianxiaomiSyncStatus: syncStatus,
                sourceUrl,
                sourcePlatform: compactText(input.sourcePlatform, 60),
                sourceNote: compactText(input.sourceNote, 400),
                objectiveInfo: compactText(input.objectiveInfo, 4000),
                notes: compactText(input.notes, 2000),
                productId: compactText(input.productId, 80) || null,
                listingTemplateRef: compactText(input.listingTemplateRef, 200) || null,
                plannedStoreIds: Array.isArray(input.plannedStoreIds) ? input.plannedStoreIds : [],
                createdAt: nowIso(),
                updatedAt: nowIso(),
                history: [{ at: nowIso(), type: "created", note: "人工录入" }]
            });
            delete item._migratedFromV1;
            this.board.items.push(item);
            await this.persist();
            return { item, board: this.snapshot() };
        });
    }

    async updateItem(id, patch = {}) {
        return this.enqueue(async () => {
            const item = this.findItem(id);
            const before = {
                developmentStage: item.developmentStage,
                dianxiaomiSyncStatus: item.dianxiaomiSyncStatus,
                name: item.name
            };

            if (patch.name !== undefined) item.name = compactText(patch.name, 200) || item.name;
            if (patch.sourceUrl !== undefined) item.sourceUrl = compactText(patch.sourceUrl, 2000);
            if (patch.sourcePlatform !== undefined) item.sourcePlatform = compactText(patch.sourcePlatform, 60);
            if (patch.sourceNote !== undefined) item.sourceNote = compactText(patch.sourceNote, 400);
            if (patch.objectiveInfo !== undefined) item.objectiveInfo = compactText(patch.objectiveInfo, 4000);
            if (patch.notes !== undefined) item.notes = compactText(patch.notes, 2000);
            if (patch.seq !== undefined && Number.isFinite(Number(patch.seq))) item.seq = Number(patch.seq);
            if (patch.productId !== undefined) item.productId = compactText(patch.productId, 80) || null;
            if (patch.listingTemplateRef !== undefined) item.listingTemplateRef = compactText(patch.listingTemplateRef, 200) || null;
            if (patch.templateSnapshotId !== undefined) item.templateSnapshotId = compactText(patch.templateSnapshotId, 80) || null;
            if (patch.plannedStoreIds !== undefined) {
                item.plannedStoreIds = Array.isArray(patch.plannedStoreIds)
                    ? patch.plannedStoreIds.map((value) => compactText(value, 80)).filter(Boolean)
                    : [];
            }
            if (patch.automation !== undefined) item.automation = { autoPickup: Boolean(patch.automation?.autoPickup) };
            if (patch.skuTable !== undefined) {
                item.skuTable = patch.skuTable === null ? null : (normalizeSkuTable(patch.skuTable) ?? null);
            }
            if (patch.listing !== undefined) item.listing = patch.listing;

            /* ── 状态写入：三条独立通道，互不覆盖 ── */
            if (patch.developmentStage !== undefined) {
                const next = String(patch.developmentStage).trim().toUpperCase();
                if (!DEV_STAGE_IDS.has(next)) throw new Error(`未知开发阶段：${patch.developmentStage}`);
                if (next !== item.developmentStage) {
                    item.history.push({
                        at: nowIso(),
                        type: "development_stage",
                        from: item.developmentStage,
                        to: next,
                        note: compactText(patch.stageNote, 200)
                    });
                    item.developmentStage = next;
                }
            }
            if (patch.dianxiaomiSyncStatus !== undefined) {
                const next = String(patch.dianxiaomiSyncStatus).trim().toUpperCase();
                if (!SYNC_IDS.has(next)) throw new Error(`未知店小秘同步状态：${patch.dianxiaomiSyncStatus}`);
                if (next !== item.dianxiaomiSyncStatus) {
                    item.history.push({
                        at: nowIso(),
                        type: "dianxiaomi_sync_status",
                        from: item.dianxiaomiSyncStatus,
                        to: next,
                        note: compactText(patch.syncNote, 200)
                    });
                    item.dianxiaomiSyncStatus = next;
                }
            }
            /* 兼容旧客户端：写 status 时按映射表落到两套新状态 */
            if (patch.status !== undefined) {
                const legacy = String(patch.status).trim().toUpperCase();
                if (!LEGACY_STATUS_IDS.has(legacy)) throw new Error(`未知状态：${patch.status}`);
                const mapped = LEGACY_STATUS_TO_STATE[legacy];
                item.legacyStatus = legacy;
                if (mapped.development_stage !== item.developmentStage) {
                    item.history.push({
                        at: nowIso(),
                        type: "development_stage",
                        from: item.developmentStage,
                        to: mapped.development_stage,
                        note: `旧接口写入 status=${legacy}`
                    });
                    item.developmentStage = mapped.development_stage;
                }
                // 只有 SAVED_DXM 会推进同步状态；其它旧状态不重置已有同步结果
                if (legacy === "SAVED_DXM" && item.dianxiaomiSyncStatus !== "SYNCED") {
                    item.history.push({
                        at: nowIso(),
                        type: "dianxiaomi_sync_status",
                        from: item.dianxiaomiSyncStatus,
                        to: "SYNCED",
                        note: "旧接口写入 status=SAVED_DXM"
                    });
                    item.dianxiaomiSyncStatus = "SYNCED";
                }
            }

            this.touch(item);
            if (before.name !== item.name) {
                item.history.push({ at: item.updatedAt, type: "rename", from: before.name, to: item.name });
            }
            await this.persist();
            return { item, board: this.snapshot() };
        });
    }

    /** 逐店刊登状态写入：只动指定 store，绝不影响其他店铺。 */
    async upsertStoreListing(id, input = {}) {
        return this.enqueue(async () => {
            const item = this.findItem(id);
            const storeId = compactText(input.storeId, 80);
            if (!storeId) throw new Error("缺少 storeId");
            const status = compactText(input.status, 40).toUpperCase();
            if (!STORE_LISTING_IDS.has(status)) throw new Error(`未知店铺刊登状态：${input.status}`);

            let entry = item.storeListings.find((listing) => listing.storeId === storeId);
            if (!entry) {
                entry = this.normalizeStoreListing({ storeId, status: "PLANNED" });
                item.storeListings.push(entry);
            }
            const from = entry.status;
            entry.status = status;
            entry.externalStoreCode = compactText(input.externalStoreCode, 80) || entry.externalStoreCode;
            if (input.listingUrl !== undefined) entry.listingUrl = compactText(input.listingUrl, 2000);
            if (input.platformListingId !== undefined) entry.platformListingId = compactText(input.platformListingId, 200);
            if (input.failureReason !== undefined) entry.failureReason = compactText(input.failureReason, 500);
            if (status === "PUBLISHED") entry.publishedAt = entry.publishedAt ?? nowIso();
            entry.updatedAt = nowIso();
            entry.history.push({ at: entry.updatedAt, from, to: status, note: compactText(input.note, 200) });

            // 计划店铺与刊登记录保持一致性（有刊登记录就算计划过）
            if (!item.plannedStoreIds.includes(storeId)) item.plannedStoreIds.push(storeId);

            item.history.push({
                at: nowIso(),
                type: "store_listing",
                note: `店铺 ${storeId}：${from} → ${status}`
            });
            this.touch(item);
            await this.persist();
            return { item, board: this.snapshot() };
        });
    }

    async removeItem(id, options = {}) {
        return this.enqueue(async () => {
            const item = this.findItem(id);
            this.board.items = this.board.items.filter((entry) => entry.id !== item.id);
            await this.persist();
            if (options.purge) {
                for (const kind of ["image", "style"]) {
                    const names = await this.listImages(item, kind);
                    for (const entry of names) {
                        await unlink(entry.path).catch(() => undefined);
                    }
                }
            }
            return { removed: item.id, board: this.snapshot() };
        });
    }

    /* ══ 素材导入 ══ */
    async addImages(id, files, options = {}) {
        const item = this.findItem(id);
        if (!files?.length) throw new Error("没有收到图片文件");
        const dir = this.itemDir(item, "image");
        const room = MAX_IMAGES - item.images.length;
        if (room <= 0) throw new Error(`单个候选最多 ${MAX_IMAGES} 张产品图，请先删除不需要的图片`);
        const accepted = files.slice(0, room);
        const result = await importImagesToDirectory(dir, accepted, [], { ...options, allowDuplicateContent: true });
        const existing = new Set(item.images.map((image) => image.name));
        for (const name of result.imported) {
            if (existing.has(name)) continue;
            item.images.push({
                name,
                assetType: this.nextAssetType(item),
                origin: "upload",
                // 本地上传没有来源 URL：明确 NOT_APPLICABLE，不是"漏存"
                sourceUrl: "",
                sourceUrlStatus: "NOT_APPLICABLE",
                downloadStatus: "OK",
                addedAt: nowIso()
            });
        }
        this.touch(item, `新增 ${result.imported.length} 张产品图`);
        await this.persist();
        return { item, result, board: this.snapshot() };
    }

    /**
     * 图片直链导入 —— Phase 1 修复重点。
     *
     * 原实现批量调用 importImageUrlsToDirectory 后无法把「文件名」对应回「原始 URL」，
     * 于是 sourceUrl 永远是空字符串。这里改成**逐条下载**：每个 URL 单独落地并立刻
     * 记录原始 URL，失败也保留 URL（downloadStatus=FAILED），绝不丢用户输入。
     */
    async addImageUrls(id, urls) {
        const item = this.findItem(id);
        const room = MAX_IMAGES - item.images.length;
        if (room <= 0) throw new Error(`单个候选最多 ${MAX_IMAGES} 张产品图，请先删除不需要的图片`);
        const trimmed = (Array.isArray(urls) ? urls : [])
            .map((url) => String(url ?? "").trim())
            .filter(Boolean)
            .slice(0, room);
        if (!trimmed.length) throw new Error("请至少输入一个图片直链");

        const dir = this.itemDir(item, "image");
        const imported = [];
        const rejected = [];
        const failed = [];

        for (const url of trimmed) {
            try {
                const buffer = await this.downloadImage(url);
                const extension = detectImageExtension(buffer);
                if (!extension) throw new Error("不是支持的 JPG、PNG 或 WEBP 图片");
                const parsed = new URL(url);
                const urlName = path.basename(decodeURIComponent(parsed.pathname));
                const stem = path.basename(urlName, path.extname(urlName)) || `url-image-${imported.length + 1}`;
                const result = await importImagesToDirectory(
                    dir,
                    [{ originalname: `${stem}${extension}`, buffer }],
                    [],
                    { allowDuplicateContent: true }
                );
                if (!result.imported.length) {
                    failed.push({ url, reason: result.rejected?.[0] ? "文件被拒绝（格式或大小）" : "重复或写入失败" });
                    continue;
                }
                const name = result.imported[0];
                item.images.push({
                    name,
                    assetType: this.nextAssetType(item),
                    origin: "url",
                    // ★ 原始 URL 原样保存：不规范化、不改写、不猜测
                    sourceUrl: url,
                    sourceUrlStatus: "RECORDED",
                    downloadStatus: "OK",
                    addedAt: nowIso()
                });
                imported.push({ name, url });
            } catch (error) {
                rejected.push(url);
                failed.push({ url, reason: error instanceof Error ? error.message : String(error) });
            }
        }

        this.touch(item, `经直链新增 ${imported.length} 张产品图（失败 ${failed.length} 条，原始 URL 已留存）`);
        await this.persist();
        return {
            item,
            result: { imported: imported.map((entry) => entry.name), rejected, failed, urlMap: imported },
            board: this.snapshot()
        };
    }

    async removeImage(id, name) {
        const item = this.findItem(id);
        const fileName = path.basename(String(name ?? ""));
        if (fileName !== name || !isSupportedImage(fileName)) throw new Error("无效的图片文件名");
        await unlink(path.join(this.itemDir(item, "image"), fileName)).catch((error) => {
            if (error?.code !== "ENOENT") throw error;
        });
        item.images = item.images.filter((image) => image.name !== fileName);
        // 主图被删后，把剩下的第一张提升为主图，避免出现"没有主图"的半残状态
        if (!item.images.some((image) => image.assetType === "MAIN" || image.assetType === "ADDITIONAL") && item.images.length) {
            item.images[0].assetType = "MAIN";
        }
        this.touch(item, `删除产品图 ${fileName}`);
        await this.persist();
        return { item, board: this.snapshot() };
    }

    async addStyleRefs(id, files) {
        const item = this.findItem(id);
        if (!files?.length) throw new Error("没有收到参考风格图文件");
        const room = MAX_STYLE_REFS - item.styleRefs.length;
        if (room <= 0) throw new Error(`单个候选最多 ${MAX_STYLE_REFS} 张参考风格图`);
        const dir = this.itemDir(item, "style");
        const result = await importImagesToDirectory(dir, files.slice(0, room), [], { allowDuplicateContent: true });
        const existing = new Set(item.styleRefs.map((image) => image.name));
        for (const name of result.imported) {
            if (existing.has(name)) continue;
            item.styleRefs.push({
                name,
                // ★ 风格图必须带 STYLE_REFERENCE 标记，扫描器据此排除
                assetType: "STYLE_REFERENCE",
                origin: "upload",
                sourceUrl: "",
                addedAt: nowIso()
            });
        }
        this.touch(item, `新增 ${result.imported.length} 张参考风格图`);
        await this.persist();
        return { item, result, board: this.snapshot() };
    }

    async removeStyleRef(id, name) {
        const item = this.findItem(id);
        const fileName = path.basename(String(name ?? ""));
        if (fileName !== name || !isSupportedImage(fileName)) throw new Error("无效的图片文件名");
        await unlink(path.join(this.itemDir(item, "style"), fileName)).catch((error) => {
            if (error?.code !== "ENOENT") throw error;
        });
        item.styleRefs = item.styleRefs.filter((image) => image.name !== fileName);
        this.touch(item, `删除参考风格图 ${fileName}`);
        await this.persist();
        return { item, board: this.snapshot() };
    }

    /* ══ 推送上品流程 ══
       整目录替换：先清空 当前产品/产品图 与 风格参考图，再写入本候选素材。
       Phase 1 增加幂等键：同一 item + 同一素材指纹重复推送，直接返回上次结果，
       不产生第二次副作用（避免重复上架/重复覆盖）。 */
    pushIdempotencyKey(item) {
        const fingerprint = [
            item.id,
            item.images.map((image) => image.name).join(","),
            item.styleRefs.map((image) => image.name).join(","),
            item.objectiveInfo
        ].join("|");
        return createHash("sha256").update(fingerprint).digest("hex").slice(0, 24);
    }

    async pushToListing(id, deps) {
        const item = this.findItem(id);
        if (!item.images.length) throw new Error("该候选还没有产品图，无法推送上品");

        const idempotencyKey = this.pushIdempotencyKey(item);
        if (item.pushIdempotencyKey === idempotencyKey && ["LISTING_IN_PROGRESS", "QC_PENDING", "QC_PASSED", "LISTING_READY"].includes(item.developmentStage)) {
            return {
                item,
                listing: item.listing,
                product: { imported: [], skippedDuplicates: [], rejected: [] },
                style: { imported: [], skippedDuplicates: [], rejected: [] },
                board: this.snapshot(),
                objectiveInfo: item.objectiveInfo,
                idempotentReplay: true,
                idempotencyKey
            };
        }

        const readFileSafe = async (dir, name) => {
            try {
                return await readFile(path.join(dir, name));
            } catch {
                return null;
            }
        };

        const productFiles = [];
        for (const image of item.images) {
            const buffer = await readFileSafe(this.itemDir(item, "image"), image.name);
            if (buffer) productFiles.push({ originalname: image.name, buffer });
        }
        if (!productFiles.length) throw new Error("候选图片文件缺失（可能已被手动删除），请重新上传");

        await clearProductImages();
        const productResult = await importProductImages(productFiles);

        let styleResult = { imported: [], skippedDuplicates: [], rejected: [] };
        await clearStyleReferenceImages();
        const styleFiles = [];
        for (const image of item.styleRefs) {
            const buffer = await readFileSafe(this.itemDir(item, "style"), image.name);
            if (buffer) styleFiles.push({ originalname: image.name, buffer });
        }
        if (styleFiles.length) {
            styleResult = await importStyleReferenceImages(styleFiles);
            await invalidateStyleLock("从选品看板推送新的参考风格图");
        }

        const listing = {
            pushedAt: nowIso(),
            sourceItemId: item.id,
            productName: slug(item.name),
            imageCount: productResult.imported.length,
            styleRefCount: styleResult.imported.length,
            idempotencyKey
        };
        item.listing = listing;
        item.pushIdempotencyKey = idempotencyKey;
        const fromStage = item.developmentStage;
        item.developmentStage = "LISTING_IN_PROGRESS";
        item.history.push({
            at: listing.pushedAt,
            type: "development_stage",
            from: fromStage,
            to: "LISTING_IN_PROGRESS",
            note: `推送上品：${productResult.imported.length} 张产品图 / ${styleResult.imported.length} 张风格图`
        });
        this.touch(item);
        await this.persist();

        return {
            item,
            listing,
            product: productResult,
            style: styleResult,
            board: this.snapshot(),
            objectiveInfo: item.objectiveInfo,
            idempotentReplay: false,
            idempotencyKey
        };
    }

    /* ══ 自动化预留：周期检查「是否有新品需要上架」（只读，不触发写）══ */
    pickupCandidates() {
        return this.board.items
            .filter((item) => item.automation?.autoPickup)
            .filter((item) => ["DISCOVERED", "DATA_ENTRY", "READY_FOR_LISTING"].includes(item.developmentStage))
            .filter((item) => item.images.length > 0 && item.objectiveInfo.trim().length > 0)
            .map((item) => ({
                id: item.id,
                name: item.name,
                developmentStage: item.developmentStage,
                imageCount: item.images.length
            }));
    }
}
