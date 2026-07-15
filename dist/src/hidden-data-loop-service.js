import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ACTION_LOG_FILE, COMMAND_INBOX_FILE, EVENT_LOG_FILE, HIDDEN_DATA_DIR, KNOWLEDGE_ITEMS_FILE, QCLAW_RESULTS_FILE, QCLAW_STATE_FILE, QCLAW_TASKS_FILE, REVIEWS_FILE, SNAPSHOTS_FILE, TASK_STATE_FILE, TODAY_DASHBOARD_FILE } from "./config.js";
import { enqueueFileWrite } from "./json-write-queue.js";
export const QCLAW_TASK_STATUSES = [
    "draft",
    "pending_approval",
    "approved",
    "queued",
    "running",
    "success",
    "failed",
    "needs_human",
    "cancelled"
];
export const KNOWLEDGE_ITEM_STATUSES = [
    "draft",
    "pending_review",
    "approved",
    "deprecated",
    "conflict"
];
const TERMINAL_QCLAW_STATUSES = new Set([
    "success",
    "cancelled"
]);
const QCLAW_TRANSITIONS = {
    draft: ["pending_approval", "cancelled"],
    pending_approval: ["approved", "cancelled"],
    approved: ["queued", "cancelled"],
    queued: ["running", "cancelled"],
    running: ["success", "failed", "needs_human", "cancelled"],
    failed: ["pending_approval", "cancelled"],
    needs_human: ["pending_approval", "cancelled"],
    success: [],
    cancelled: []
};
const DEFAULT_JSON = {
    task_state: { schema_version: "1.0", updated_at: "", tasks: [] },
    today_dashboard: {
        schema_version: "1.0",
        updated_at: "",
        data_mode: "official",
        include_test_data: false,
        test_data_filtered: true,
        test_record_count: 0,
        today_task_count: 0,
        qclaw_pending_approval: 0,
        qclaw_running: 0,
        qclaw_failed_or_needs_human: 0,
        pending_review_count: 0,
        knowledge_pending_review: 0,
        qclaw_tasks_total: 0
    },
    qclaw_state: { schema_version: "1.0", updated_at: "", tasks: [] }
};
function textHasTestMarker(value) {
    return typeof value === "string" && /\b(smoke|qa)\b/i.test(value);
}
function arrayHasTestMarker(value) {
    return Array.isArray(value) && value.some((item) => textHasTestMarker(item));
}
function isHiddenTestRecord(record) {
    const payload = record.payload && typeof record.payload === "object"
        ? record.payload
        : {};
    return Boolean(record.smoke_test === true ||
        payload.smoke_test === true ||
        textHasTestMarker(record.source) ||
        textHasTestMarker(record.tag) ||
        textHasTestMarker(payload.source) ||
        textHasTestMarker(payload.tag) ||
        arrayHasTestMarker(record.tags) ||
        arrayHasTestMarker(payload.tags));
}
export class HiddenDataLoopService {
    dataDir;
    constructor(options = {}) {
        this.dataDir = options.dataDir ?? HIDDEN_DATA_DIR;
    }
    filePath(kind) {
        const files = {
            command_inbox: this.resolve(COMMAND_INBOX_FILE),
            event_log: this.resolve(EVENT_LOG_FILE),
            qclaw_tasks: this.resolve(QCLAW_TASKS_FILE),
            qclaw_results: this.resolve(QCLAW_RESULTS_FILE),
            action_log: this.resolve(ACTION_LOG_FILE),
            snapshots: this.resolve(SNAPSHOTS_FILE),
            reviews: this.resolve(REVIEWS_FILE),
            knowledge_items: this.resolve(KNOWLEDGE_ITEMS_FILE),
            task_state: this.resolve(TASK_STATE_FILE),
            today_dashboard: this.resolve(TODAY_DASHBOARD_FILE),
            qclaw_state: this.resolve(QCLAW_STATE_FILE)
        };
        return files[kind];
    }
    async ensureHiddenDataFiles() {
        await mkdir(this.dataDir, { recursive: true });
        await Promise.all([
            "command_inbox",
            "event_log",
            "qclaw_tasks",
            "qclaw_results",
            "action_log",
            "snapshots",
            "reviews",
            "knowledge_items"
        ].map((kind) => this.ensureFile(this.filePath(kind), "")));
        await Promise.all(["task_state", "today_dashboard", "qclaw_state"].map((kind) => this.ensureFile(this.filePath(kind), `${JSON.stringify(DEFAULT_JSON[kind], null, 2)}\n`)));
    }
    async hiddenDataFileStatus() {
        const kinds = [
            "command_inbox",
            "event_log",
            "qclaw_tasks",
            "qclaw_results",
            "action_log",
            "snapshots",
            "reviews",
            "knowledge_items",
            "task_state",
            "today_dashboard",
            "qclaw_state"
        ];
        return Promise.all(kinds.map(async (kind) => ({
            path: this.filePath(kind),
            exists: await this.exists(this.filePath(kind))
        })));
    }
    async appendJsonl(kind, record) {
        await this.ensureHiddenDataFiles();
        const normalized = this.normalizeRecord(record);
        const file = this.filePath(kind);
        await enqueueFileWrite(file, async () => {
            await writeFile(file, `${JSON.stringify(normalized)}\n`, { flag: "a" });
        });
        return normalized;
    }
    async readJsonl(kind) {
        await this.ensureHiddenDataFiles();
        const content = await readFile(this.filePath(kind), "utf8");
        return content
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
    async writeJson(kind, data) {
        await this.ensureHiddenDataFiles();
        const file = this.filePath(kind);
        await enqueueFileWrite(file, async () => {
            const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
            await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
            await rename(temporary, file);
        });
    }
    async readJson(kind) {
        await this.ensureHiddenDataFiles();
        return JSON.parse(await readFile(this.filePath(kind), "utf8"));
    }
    async appendEvent(event) {
        return this.appendJsonl("event_log", event);
    }
    async createCommand(command) {
        const saved = await this.appendJsonl("command_inbox", command);
        await this.appendEvent({
            type: "command.created",
            source: saved.source,
            correlation_id: saved.correlation_id,
            command_id: saved.id,
            payload: saved.payload
        });
        await this.rebuildTodayDashboard();
        return saved;
    }
    async createFeishuCommand(payload) {
        return this.createCommand({
            type: "feishu.webhook.command",
            source: "feishu",
            payload
        });
    }
    async createQclawTask(task) {
        const status = this.normalizeQclawInitialStatus(task.status ?? "draft", task.risk_level ?? "L1");
        this.assertQclawStatus(status);
        const saved = await this.appendJsonl("qclaw_tasks", {
            ...task,
            status,
            risk_level: task.risk_level ?? "L1"
        });
        await this.appendEvent({
            type: "qclaw.task.created",
            source: saved.source,
            correlation_id: saved.correlation_id,
            task_id: saved.id,
            status: saved.status,
            risk_level: saved.risk_level
        });
        await Promise.all([this.rebuildQclawState(), this.rebuildTodayDashboard()]);
        return saved;
    }
    async appendQclawResult(result) {
        this.assertQclawStatus(result.status);
        const saved = await this.appendJsonl("qclaw_results", result);
        await this.appendEvent({
            type: "qclaw.result.created",
            source: saved.source,
            correlation_id: saved.correlation_id,
            task_id: saved.task_id,
            status: saved.status
        });
        await Promise.all([this.rebuildQclawState(), this.rebuildTodayDashboard()]);
        return saved;
    }
    async appendActionLog(action) {
        const saved = await this.appendJsonl("action_log", action);
        await this.appendEvent({
            type: "action_log.created",
            source: saved.source,
            correlation_id: saved.correlation_id,
            action_id: saved.id
        });
        await this.rebuildTodayDashboard();
        return saved;
    }
    async createKnowledgeItem(item) {
        if (!KNOWLEDGE_ITEM_STATUSES.includes(item.status)) {
            throw new Error(`Invalid knowledge item status: ${item.status}`);
        }
        if (item.source === "secretary" && item.status === "approved") {
            throw new Error("Secretary cannot auto approve knowledge items");
        }
        const saved = await this.appendJsonl("knowledge_items", item);
        await this.appendEvent({
            type: "knowledge_item.created",
            source: saved.source,
            correlation_id: saved.correlation_id,
            knowledge_item_id: saved.id,
            status: saved.status
        });
        await this.rebuildTodayDashboard();
        return saved;
    }
    validateQclawTransition(from, to) {
        this.assertQclawStatus(from);
        this.assertQclawStatus(to);
        if (TERMINAL_QCLAW_STATUSES.has(from))
            return false;
        return QCLAW_TRANSITIONS[from].includes(to);
    }
    async rebuildTodayDashboard(options = {}) {
        const includeTestData = options.includeTestData === true;
        const persist = options.persist !== false;
        const [allTasks, allResults, allActionLogs, allReviews, allKnowledgeItems] = await Promise.all([
            this.readJsonl("qclaw_tasks"),
            this.readJsonl("qclaw_results"),
            this.readJsonl("action_log"),
            this.readJsonl("reviews"),
            this.readJsonl("knowledge_items")
        ]);
        const allRecords = [
            ...allTasks,
            ...allResults,
            ...allActionLogs,
            ...allReviews,
            ...allKnowledgeItems
        ];
        const directlyMarkedTestRecords = allRecords.filter(isHiddenTestRecord);
        const testCorrelationIds = new Set(directlyMarkedTestRecords
            .map((record) => record.correlation_id)
            .filter((value) => typeof value === "string" && value.length > 0));
        const testTaskIds = new Set(allTasks
            .filter((task) => isHiddenTestRecord(task))
            .map((task) => task.id));
        const isProjectionTestRecord = (record) => isHiddenTestRecord(record) ||
            (typeof record.correlation_id === "string" && testCorrelationIds.has(record.correlation_id)) ||
            (typeof record.task_id === "string" && testTaskIds.has(record.task_id)) ||
            (typeof record.source_task_id === "string" && testTaskIds.has(record.source_task_id));
        const testRecordCount = allRecords.filter(isProjectionTestRecord).length;
        const filterRecords = (records) => includeTestData ? records : records.filter((record) => !isProjectionTestRecord(record));
        const tasks = filterRecords(allTasks);
        const results = filterRecords(allResults);
        const actionLogs = filterRecords(allActionLogs);
        const reviews = filterRecords(allReviews);
        const knowledgeItems = filterRecords(allKnowledgeItems);
        const projection = {
            schema_version: "1.0",
            updated_at: new Date().toISOString(),
            data_mode: includeTestData ? "includes_test_data" : "official",
            include_test_data: includeTestData,
            test_data_filtered: !includeTestData,
            test_record_count: testRecordCount,
            today_task_count: actionLogs.length,
            qclaw_pending_approval: tasks.filter((task) => task.status === "pending_approval").length,
            qclaw_running: tasks.filter((task) => task.status === "running").length,
            qclaw_failed_or_needs_human: tasks.filter((task) => ["failed", "needs_human"].includes(task.status)).length +
                results.filter((result) => ["failed", "needs_human"].includes(result.status)).length,
            pending_review_count: reviews.length,
            knowledge_pending_review: knowledgeItems.filter((item) => item.status === "pending_review").length,
            qclaw_tasks_total: tasks.length
        };
        if (persist) {
            await this.writeJson("today_dashboard", projection);
        }
        return projection;
    }
    async rebuildTaskState() {
        const commands = await this.readJsonl("command_inbox");
        const state = {
            schema_version: "1.0",
            updated_at: new Date().toISOString(),
            commands_total: commands.length
        };
        await this.writeJson("task_state", state);
        return state;
    }
    async rebuildQclawState() {
        const tasks = await this.readJsonl("qclaw_tasks");
        const results = await this.readJsonl("qclaw_results");
        const state = {
            schema_version: "1.0",
            updated_at: new Date().toISOString(),
            tasks,
            results
        };
        await this.writeJson("qclaw_state", state);
        return state;
    }
    resolve(defaultPath) {
        return path.join(this.dataDir, path.basename(defaultPath));
    }
    async ensureFile(file, initialContent) {
        if (await this.exists(file))
            return;
        await mkdir(path.dirname(file), { recursive: true });
        await enqueueFileWrite(file, async () => {
            if (await this.exists(file))
                return;
            await writeFile(file, initialContent);
        });
    }
    async exists(file) {
        try {
            await stat(file);
            return true;
        }
        catch {
            return false;
        }
    }
    normalizeRecord(record) {
        const now = new Date().toISOString();
        const id = record.id ?? `${record.type.replace(/[^a-z0-9]+/gi, "-")}-${randomUUID()}`;
        const correlationId = record.correlation_id ?? `corr-${randomUUID()}`;
        return {
            ...record,
            id,
            created_at: record.created_at ?? now,
            schema_version: record.schema_version ?? "1.0",
            correlation_id: correlationId
        };
    }
    normalizeQclawInitialStatus(status, riskLevel) {
        if (riskLevel === "L3")
            return "pending_approval";
        if (!["draft", "pending_approval", "approved", "queued"].includes(status)) {
            throw new Error(`Invalid initial status for qclaw task: ${status}`);
        }
        return status;
    }
    assertQclawStatus(status) {
        if (!QCLAW_TASK_STATUSES.includes(status)) {
            throw new Error(`Invalid qclaw status: ${status}`);
        }
    }
}
//# sourceMappingURL=hidden-data-loop-service.js.map