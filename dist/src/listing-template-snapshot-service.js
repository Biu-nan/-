/**
 * Listing 模板本地快照（Phase 1 / G. Listing 模板本地快照）
 *
 * 背景（实测证据，见 TEMPLATE_LOCAL_SNAPSHOT_DESIGN.md）：
 *   店小秘模板是**平台侧 UI 对象**，一跨只能按模板**名称**匹配
 *   （`dist/src/dianxiaomi-adapter.js` 里的"引用产品模板"流程），
 *   平台既不返回模板 ID，也不返回版本号。因此：
 *     - 不允许伪造 platform_template_version；
 *     - 只能保存"我们实际读到的那份规则副本"，并给它一个**一跨本地**版本号；
 *     - 平台模板后续被改，本地快照不会自动跟着变 → 必须能识别 STALE。
 *
 * 设计红线：
 *   1. 本地快照版本（local_snapshot_version）与平台版本是两个空间，
 *      任何字段都不得声称自己是平台版本；
 *   2. 快照内容无法自动读取时，状态必须是 MANUAL_CAPTURE_REQUIRED，不静默用默认模板；
 *   3. 捕获方式必须记录（人工粘贴 / 本地文件 / 配置导出），便于追溯可信度。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const SNAPSHOT_STATUS = Object.freeze({
    CAPTURED: "CAPTURED",
    MANUAL_CAPTURE_REQUIRED: "MANUAL_CAPTURE_REQUIRED",
    STALE: "STALE",
    SUPERSEDED: "SUPERSEDED"
});

export const CAPTURE_METHOD = Object.freeze({
    MANUAL_INPUT: "MANUAL_INPUT",
    LOCAL_FILE: "LOCAL_FILE",
    CONFIG_EXPORT: "CONFIG_EXPORT",
    AGENT_READ: "AGENT_READ"
});

/** 平台版本号的唯一合法值：明确"不可得"，不是空字符串，也不是 "unknown"。 */
export const PLATFORM_VERSION_UNAVAILABLE = "NOT_AVAILABLE_FROM_PLATFORM";

const nowIso = () => new Date().toISOString();
const initial = () => ({ schemaVersion: "1.0", snapshots: [], updatedAt: nowIso() });

function contentHash(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

function compact(value, max = 4000) {
    if (value === undefined || value === null) return "";
    return String(value).slice(0, max);
}

export class ListingTemplateSnapshotService {
    pending = Promise.resolve();

    constructor(options = {}) {
        this.dataDir = options.dataDir ?? path.join(process.cwd(), "data", "identity");
        this.file = path.join(this.dataDir, "template-snapshots.json");
        this.state = initial();
    }

    enqueue(operation) {
        const next = this.pending.then(operation);
        this.pending = next.catch(() => undefined);
        return next;
    }

    async load() {
        await mkdir(this.dataDir, { recursive: true });
        try {
            const parsed = JSON.parse(await readFile(this.file, "utf8"));
            this.state = { ...initial(), ...parsed, snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [] };
        } catch (error) {
            if (error?.code !== "ENOENT") {
                console.warn("[template-snapshot] 读取失败，从空结构开始:", error?.message ?? error);
            }
            this.state = initial();
            await this.persist();
        }
        return this.list();
    }

    async persist() {
        this.state.updatedAt = nowIso();
        const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(this.state, null, 2), "utf8");
        await rename(temp, this.file);
    }

    list() {
        return this.state.snapshots.map((snapshot) => ({ ...snapshot }));
    }

    find(snapshotId) {
        return this.state.snapshots.find((snapshot) => snapshot.snapshot_id === snapshotId) ?? null;
    }

    /**
     * 捕获一份本地快照。
     * @param {object} input
     * @param {string} input.templateRef   模板引用 = 店小秘模板名称（平台无稳定 ID）
     * @param {string} [input.templateName]
     * @param {string} [input.content]     规则正文/JSON 文本；缺省即"无法自动读取"
     * @param {string} [input.contentFileRef] 规则文件路径（content 为空时用它指向本地副本）
     * @param {string} [input.captureMethod]
     * @param {string} [input.productId]   关联产品（可选，模板可跨产品复用）
     * @param {string} [input.platformTemplateVersion] 只接受 PLATFORM_VERSION_UNAVAILABLE
     */
    async capture(input = {}) {
        return this.enqueue(async () => {
            const templateRef = compact(input.templateRef, 200).trim();
            if (!templateRef) throw new Error("模板引用 templateRef 不能为空");

            if (
                input.platformTemplateVersion !== undefined &&
                input.platformTemplateVersion !== PLATFORM_VERSION_UNAVAILABLE
            ) {
                throw new Error(
                    "拒绝写入平台模板版本号：店小秘不返回模板版本，任何具体值都必须是伪造。只允许 " +
                        PLATFORM_VERSION_UNAVAILABLE
                );
            }

            const content = compact(input.content, 200000);
            const contentFileRef = compact(input.contentFileRef, 500);
            const captureMethod = Object.values(CAPTURE_METHOD).includes(input.captureMethod)
                ? input.captureMethod
                : content
                  ? CAPTURE_METHOD.MANUAL_INPUT
                  : CAPTURE_METHOD.MANUAL_INPUT;

            const hasContent = Boolean(content) || Boolean(contentFileRef);
            const snapshotId = randomUUID();
            const index = this.state.snapshots.filter((snapshot) => snapshot.template_ref === templateRef).length + 1;

            const snapshot = {
                snapshot_id: snapshotId,
                product_id: compact(input.productId, 80) || null,
                template_ref: templateRef,
                template_name: compact(input.templateName, 200) || templateRef,
                // 一跨内部版本号：与平台无关，单调递增，便于人工对照
                local_snapshot_version: `LOCAL-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${index}`,
                content_hash: hasContent ? contentHash(content || contentFileRef) : "",
                content,
                content_file_ref: contentFileRef,
                capture_method: captureMethod,
                captured_at: nowIso(),
                snapshot_status: hasContent ? SNAPSHOT_STATUS.CAPTURED : SNAPSHOT_STATUS.MANUAL_CAPTURE_REQUIRED,
                // 平台版本：永远明确不可得，绝不填具体值
                platform_template_version: PLATFORM_VERSION_UNAVAILABLE,
                // 说明这份快照能证明什么、不能证明什么
                provenance_note: hasContent
                    ? "一跨本地规则副本；不代表店小秘平台模板的真实版本号。"
                    : "未取得模板内容，需人工提供规则副本后重新捕获。",
                source_platform: compact(input.sourcePlatform, 60) || "dianxiaomi"
            };

            // 同一模板的旧快照标记 SUPERSEDED（保留，不删）
            for (const existing of this.state.snapshots) {
                if (existing.template_ref === templateRef && existing.snapshot_status === SNAPSHOT_STATUS.CAPTURED) {
                    existing.snapshot_status = SNAPSHOT_STATUS.SUPERSEDED;
                }
            }

            this.state.snapshots.push(snapshot);
            await this.persist();
            return { snapshot, supersededOthers: this.state.snapshots.filter((s) => s.template_ref === templateRef).length - 1 };
        });
    }

    /** Listing 任务开跑前调用：必须有可用快照，否则 BLOCKED_TEMPLATE，不静默用默认模板。 */
    requireUsableSnapshot(templateRef) {
        const latest = [...this.state.snapshots]
            .reverse()
            .find((snapshot) => snapshot.template_ref === templateRef && snapshot.snapshot_status === SNAPSHOT_STATUS.CAPTURED);
        if (!latest) {
            return {
                ok: false,
                blocked: "BLOCKED_TEMPLATE",
                reason: `模板「${templateRef}」没有可用的本地快照（状态需为 CAPTURED），不允许静默使用默认模板`,
                snapshot: null
            };
        }
        return { ok: true, blocked: null, reason: "OK", snapshot: latest };
    }

    /** 内容变了就置 STALE，而不是悄悄继续用旧规则。 */
    async markStale(templateRef, reason = "") {
        return this.enqueue(async () => {
            let changed = 0;
            for (const snapshot of this.state.snapshots) {
                if (snapshot.template_ref === templateRef && snapshot.snapshot_status === SNAPSHOT_STATUS.CAPTURED) {
                    snapshot.snapshot_status = SNAPSHOT_STATUS.STALE;
                    snapshot.stale_reason = compact(reason, 300);
                    changed += 1;
                }
            }
            if (changed) await this.persist();
            return { changed };
        });
    }
}
