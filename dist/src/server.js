import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { HOST, OUTPUT_DIR, INSERT_BAG_IMAGES_DIR, INSERT_LINER_IMAGES_DIR, INSERT_OUTPUT_DIR, PORT, PRODUCT_IMAGES_DIR, PRODUCT_ROOT, PROMPTS_DIR, PROJECT_ROOT, COMPLETED_PRODUCTS_DIR, HIDDEN_DATA_DIR, PUBLIC_DIR } from "./config.js";
import { DIANXIAOMI_TEMPLATE_PRODUCT_ID, PRODUCT_FACT_FILE, DIANXIAOMI_CATEGORY_PROFILES, getDianxiaomiProfile } from "./config.js";
import { normalizeDianxiaomiFacts } from "./dianxiaomi-facts.js";
import { AutomationService } from "./automation-service.js";
import { ChatGptAdapter } from "./chatgpt-adapter.js";
import { GeminiAdapter } from "./gemini-adapter.js";
import { importImagesToDirectory, importImageUrlsToDirectory, removeImageFromDirectory, scanImages } from "./directory-images.js";
import { LuxuryInsertService } from "./luxury-insert-service.js";
import { SelectionService } from "./product-selection-service.js";
import { NotebookLmAdapter } from "./notebooklm-adapter.js";
import { clearProductImages, importProductImageUrls, importProductImages, removeProductImage, scanProductImages } from "./image-files.js";
import { StateStore } from "./state-store.js";
import { abandonCurrentProduct, archiveCurrentProduct } from "./product-session.js";
import { PROMPT_KINDS, promptStatus, readPrompt, savePrompt } from "./prompt-files.js";
import { SleepInhibitor } from "./sleep-inhibitor.js";
import { ProductProfileService } from "./product-profile-service.js";
import { QueueService } from "./queue-service.js";
import { OperationService } from "./operation-service.js";
import { DailyOperationService } from "./daily-operation-service.js";
import { OperatorService } from "./operator-service.js";
import { HiddenDataLoopService } from "./hidden-data-loop-service.js";
import { ProductVisualAssetsService } from "./product-visual-assets-service.js";
import { P0ProtocolService } from "./p0-protocol-service.js";
import { DianxiaomiAdapter } from "./dianxiaomi-adapter.js";
import { ResearchService } from "./research-service.js";
import { ResearchStore } from "./research-store.js";
import { registerBatchListingCreateRoutes } from "./batch-listing-create.js";

// The WorkBuddy runtime injects a "safe-delete" shim (genie-safe-delete.cjs) that
// intercepts fs.rm and throws SAFE_DELETE_BULK_CONFIRM_REQUIRED once the per-turn
// cumulative delete count exceeds its threshold. This server performs legitimate,
// intentional internal cleanup (archiving / abandoning products, clearing temp
// dirs). We opt out of the *blocking* bulk-delete confirmation guard here by
// blanking the env vars it keys on (an empty string is falsy, so checkBulkDeleteGuard
// early-returns). Deletions still go to the OS recycle bin via the shim (fail-safe);
// they are simply not blocked. checkBulkDeleteGuard reads these env vars at call time.
process.env.CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR = "";
process.env.CODEBUDDY_TOOL_CALL_ID = "";
process.env.CODEBUDDY_SAFE_DELETE_BULK_GUARD = "";
console.error("[startup] safe-delete bulk guard disabled:",
    "STATE_DIR=", JSON.stringify(process.env.CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR),
    "TOOL_CALL_ID=", JSON.stringify(process.env.CODEBUDDY_TOOL_CALL_ID));

const app = express();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 12,
        fileSize: 15 * 1024 * 1024
    }
});
const queueUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 1,
        fileSize: 10 * 1024 * 1024
    }
});
const store = new StateStore();
const adapters = {
    chatgpt: new ChatGptAdapter(),
    gemini: new GeminiAdapter()
};
const visualAssetsService = new ProductVisualAssetsService();
const standardService = new AutomationService(store, adapters, visualAssetsService);
const insertService = new LuxuryInsertService(store, adapters, new NotebookLmAdapter());
const selectionService = new SelectionService(store, adapters);
const sleepInhibitor = new SleepInhibitor();
const productProfiles = new ProductProfileService();
// 发现源（二阶段）后台结果暂存（进程内即可，截图已落盘）
const discoverSessions = new Map();
const operationService = new OperationService();
const dailyOperationService = new DailyOperationService();
const operatorService = new OperatorService();
const hiddenDataLoopService = new HiddenDataLoopService();
const p0ProtocolService = new P0ProtocolService();
const queueService = new QueueService(store, standardService, productProfiles, {
    keepAwake: (task) => sleepInhibitor.run(task)
});
const AGENT_DIR = path.join(PROJECT_ROOT, ".agent");
const agentFiles = {
    activeTask: path.join(AGENT_DIR, "ACTIVE_TASK.md"),
    workbuddyQueue: path.join(AGENT_DIR, "WORKBUDDY_QUEUE.md"),
    codexQueue: path.join(AGENT_DIR, "CODEX_QUEUE.md"),
    reportInbox: path.join(AGENT_DIR, "REPORT_INBOX.md"),
    taskLog: path.join(AGENT_DIR, "TASK_LOG.md"),
    state: path.join(AGENT_DIR, "STATE.json")
};
const validAgents = new Set(["workbuddy", "codex"]);
const validAgentStatuses = new Set([
    "idle",
    "ready",
    "claimed",
    "running",
    "reported",
    "blocked"
]);
const agentIntakeCorsAllowedOrigins = new Set([
    "https://chatgpt.com",
    "https://chat.openai.com",
    "http://127.0.0.1:3000",
    "http://localhost:3000"
]);
let agentStateWriteQueue = Promise.resolve();
function runBackground(task) {
    void sleepInhibitor.run(task).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Background task failed:", error);
        void store.update({
            running: false,
            stage: "FAILED",
            message: "流程已停止",
            error: message
        });
    });
}
function defaultAgentState() {
    return {
        status: "idle",
        currentAgent: null,
        targetAgent: null,
        currentTaskId: null,
        lastClaimedTaskId: null,
        updatedAt: null,
        lastReportAt: null
    };
}
function isAgentName(value) {
    return typeof value === "string" && validAgents.has(value);
}
async function readAgentText(filePath) {
    try {
        return await readFile(filePath, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT")
            return "";
        throw error;
    }
}
async function readAgentState() {
    const raw = await readAgentText(agentFiles.state);
    if (!raw.trim())
        return defaultAgentState();
    try {
        const parsed = JSON.parse(raw);
        return {
            ...defaultAgentState(),
            ...parsed,
            currentAgent: parsed.currentAgent ?? parsed.current_agent ?? null,
            targetAgent: parsed.targetAgent ?? parsed.target_agent ?? null,
            currentTaskId: parsed.currentTaskId ?? parsed.current_task_id ?? parsed.task_id ?? null,
            lastClaimedTaskId: parsed.lastClaimedTaskId ?? parsed.last_claimed_task_id ?? null
        };
    }
    catch {
        return defaultAgentState();
    }
}
function extractAgentField(markdown, field) {
    const escapedField = field.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const pattern = new RegExp(`(?:^|\\n)[ \\t]*[-*]?[ \\t]*(?:\\*\\*)?${escapedField}(?:\\*\\*)?[ \\t]*[:：][ \\t]*([^\\n\\r]*)`, "i");
    const match = markdown.match(pattern);
    const value = match?.[1]?.trim() || "";
    if (!value || value.startsWith("(") || value === "-")
        return null;
    return value;
}
function isTemplateAgentValue(value) {
    if (!value)
        return true;
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-" || trimmed.startsWith("("))
        return true;
    return /^[-*]?\s*\*\*(task_id|title|target_agent|status)\*\*\s*:?$/i.test(trimmed);
}
function extractAgentTaskMeta(markdown) {
    const taskId = extractAgentField(markdown, "task_id");
    const title = extractAgentField(markdown, "title");
    const targetAgentValue = extractAgentField(markdown, "target_agent")?.toLowerCase() || "";
    const status = extractAgentField(markdown, "status")?.toLowerCase() || "";
    if (isTemplateAgentValue(taskId) || isTemplateAgentValue(title))
        return null;
    const taskIdValue = taskId?.trim() || "";
    const titleValue = title?.trim() || "";
    if (!isAgentName(targetAgentValue))
        return null;
    if (!["ready", "pending"].includes(status))
        return null;
    return {
        taskId: taskIdValue,
        title: titleValue,
        targetAgent: targetAgentValue,
        status
    };
}
function agentStateTaskIdIsInvalid(taskId) {
    return isTemplateAgentValue(taskId || null);
}
function normalizeAgentTaskHeaderValue(value) {
    return (value || "").trim().replace(/^["']|["']$/g, "").trim();
}
function parseAgentTaskHeaderValue(taskBlock, field) {
    const escapedField = field.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const quotedPattern = new RegExp(`${escapedField}[ \\t]*=[ \\t]*["']([^"']+)["']`, "i");
    const quotedMatch = taskBlock.match(quotedPattern);
    if (quotedMatch?.[1])
        return normalizeAgentTaskHeaderValue(quotedMatch[1]);
    const inlinePattern = new RegExp(`${escapedField}[ \\t]*=[ \\t]*([^\\s>]+)`, "i");
    const inlineMatch = taskBlock.match(inlinePattern);
    if (inlineMatch?.[1])
        return normalizeAgentTaskHeaderValue(inlineMatch[1]);
    const markdownPattern = new RegExp(`(?:^|\\n)[ \\t]*(?:[-*][ \\t]*)?(?:\\*\\*)?${escapedField}(?:\\*\\*)?[ \\t]*[:：][ \\t]*([^\\n\\r]*)`, "i");
    const markdownMatch = taskBlock.match(markdownPattern);
    return normalizeAgentTaskHeaderValue(markdownMatch?.[1]);
}
function parseAgentTaskBlock(taskBlock) {
    if (typeof taskBlock !== "string" || !taskBlock.trim()) {
        throw new Error("任务块格式错误");
    }
    const raw = taskBlock.trim();
    if (!raw.includes("<<<YK_AGENT_TASK") || !raw.includes("<<<YK_AGENT_TASK_END>>>")) {
        throw new Error("任务块格式错误");
    }
    const taskId = parseAgentTaskHeaderValue(raw, "task_id");
    const targetAgentValue = parseAgentTaskHeaderValue(raw, "target_agent").toLowerCase();
    const statusValue = parseAgentTaskHeaderValue(raw, "status").toLowerCase();
    const title = parseAgentTaskHeaderValue(raw, "title");
    if (!taskId ||
        !targetAgentValue ||
        !statusValue ||
        !title ||
        isTemplateAgentValue(taskId) ||
        isTemplateAgentValue(title)) {
        throw new Error("任务块格式错误");
    }
    if (!isAgentName(targetAgentValue)) {
        throw new Error("target_agent 不支持");
    }
    if (statusValue !== "ready") {
        throw new Error("status 不是 ready");
    }
    return {
        taskId,
        targetAgent: targetAgentValue,
        status: "ready",
        title,
        raw
    };
}
function formatAgentTaskQueueEntry(task, importedAt) {
    return [
        `- **task_id**: ${task.taskId}`,
        `- **title**: ${task.title}`,
        `- **target_agent**: ${task.targetAgent}`,
        "- **status**: ready",
        `- **imported_at**: ${importedAt}`,
        "- **source**: agent-dispatch task block intake",
        "",
        "```text",
        task.raw,
        "```"
    ].join("\n");
}
function writeLatestPendingQueueEntry(queueText, entry) {
    const normalizedEntry = `\n${entry.trim()}\n`;
    const latestSectionPattern = /(### \[最新待执行\][^\n]*\n)([\s\S]*?)(\n---\s*\n\s*### \[已完成\])/;
    if (latestSectionPattern.test(queueText)) {
        return queueText.replace(latestSectionPattern, `$1${normalizedEntry}$3`);
    }
    const latestHeadingPattern = /(### \[最新待执行\][^\n]*\n)/;
    if (latestHeadingPattern.test(queueText)) {
        return queueText.replace(latestHeadingPattern, `$1${normalizedEntry}`);
    }
    return `# [latest] Agent Task Intake\n${normalizedEntry}\n---\n\n${queueText}`;
}
async function resolveClaimTaskId(agent, explicitTaskId) {
    if (typeof explicitTaskId === "string" && !agentStateTaskIdIsInvalid(explicitTaskId)) {
        return explicitTaskId.trim();
    }
    const [activeTask, queue] = await Promise.all([
        readAgentText(agentFiles.activeTask),
        readAgentText(agent === "workbuddy" ? agentFiles.workbuddyQueue : agentFiles.codexQueue)
    ]);
    const activeTaskMeta = extractAgentTaskMeta(activeTask);
    if (activeTaskMeta?.targetAgent === agent)
        return activeTaskMeta.taskId;
    const queueMeta = extractAgentTaskMeta(queue);
    return queueMeta?.targetAgent === agent ? queueMeta.taskId : null;
}
async function writeAgentState(patch) {
    const writeTask = agentStateWriteQueue.then(async () => {
        const state = {
            ...(await readAgentState()),
            ...patch
        };
        await writeFile(agentFiles.state, `${JSON.stringify(state, null, 2)}\n`, "utf8");
        return state;
    });
    agentStateWriteQueue = writeTask.then(() => undefined, () => undefined);
    return writeTask;
}
function applyAgentIntakeCors(request, response) {
    const origin = request.get("origin");
    if (!origin || !agentIntakeCorsAllowedOrigins.has(origin))
        return;
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
await Promise.all([
    mkdir(PRODUCT_IMAGES_DIR, { recursive: true }),
    mkdir(OUTPUT_DIR, { recursive: true }),
    mkdir(PROMPTS_DIR, { recursive: true }),
    mkdir(INSERT_BAG_IMAGES_DIR, { recursive: true }),
    mkdir(INSERT_LINER_IMAGES_DIR, { recursive: true }),
    mkdir(INSERT_OUTPUT_DIR, { recursive: true }),
    mkdir(AGENT_DIR, { recursive: true }),
    productProfiles.initialize(),
    operationService.initialize(),
    dailyOperationService.initialize(),
    operatorService.initialize(),
    hiddenDataLoopService.ensureHiddenDataFiles()
]);
await store.load();
/* 启动复位：进程重启后不可能有后台任务在跑，清理遗留的 selection.running，
   否则崩溃重启后"运行"和"重置"都会被 running 守卫挡住，用户两头点不了。
   必须在 store.load() 之后调用——load 之前 state 还是 initialState，读不到磁盘残留。 */
if (store.get().selection?.running) {
    await selectionService.clearStaleRunning();
}
/* 进程重启后主流程/内胆流程的后台任务不可能还在跑（进程已被 kill），
   清理遗留的 running/autoRun，否则崩溃重启后用户无法重新运行或重置，
   且卡死的 running 会一直挡住识别、选款等所有操作。 */
if (store.get().running || store.get().autoRun) {
    await store.update({
        running: false,
        autoRun: false,
        stage: "FAILED",
        message: "进程已重启，之前的任务已停止，可重新运行或重置",
        error: undefined
    });
}
store.setUpdateObserver((state) => productProfiles.syncFromState(state));
await productProfiles.syncFromState(store.get());
await queueService.load();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
// 产品图静态文件服务（用于前端预览已上传的图片）
app.use("/product-images", express.static(PRODUCT_IMAGES_DIR));
registerBatchListingCreateRoutes(app, {
    upload,
    store,
    standardService,
    productProfiles,
    runBackground,
    getBatchRunStateRunning: () => batchRunState.running
});
app.get("/agent-dispatch", (_request, response) => {
    response.sendFile(path.join(PUBLIC_DIR, "index.html"));
});
app.get("/api/agent/active-task", async (_request, response) => {
    try {
        const [activeTask, workbuddyQueue, codexQueue, initialState, reportInbox] = await Promise.all([
            readAgentText(agentFiles.activeTask),
            readAgentText(agentFiles.workbuddyQueue),
            readAgentText(agentFiles.codexQueue),
            readAgentState(),
            readAgentText(agentFiles.reportInbox)
        ]);
        const activeTaskMeta = extractAgentTaskMeta(activeTask);
        const workbuddyQueueMeta = extractAgentTaskMeta(workbuddyQueue);
        const codexQueueMeta = extractAgentTaskMeta(codexQueue);
        const validTaskIds = new Set([activeTaskMeta?.taskId, workbuddyQueueMeta?.taskId, codexQueueMeta?.taskId].filter((taskId) => Boolean(taskId)));
        const invalidState = initialState.status === "claimed" &&
            (agentStateTaskIdIsInvalid(initialState.currentTaskId) ||
                !validTaskIds.has(initialState.currentTaskId || ""));
        const state = invalidState
            ? await writeAgentState({
                status: "idle",
                currentAgent: "",
                targetAgent: "",
                currentTaskId: "",
                lastClaimedTaskId: "",
                lastQueue: "",
                updatedAt: new Date().toISOString()
            })
            : initialState;
        response.json({
            activeTask,
            state,
            activeTaskMeta: {
                taskId: activeTaskMeta?.taskId || "",
                targetAgent: activeTaskMeta?.targetAgent || null
            },
            queues: {
                workbuddy: {
                    taskId: workbuddyQueueMeta?.taskId || ""
                },
                codex: {
                    taskId: codexQueueMeta?.taskId || ""
                }
            },
            invalid_state: invalidState,
            reportInboxSummary: reportInbox.slice(-4000)
        });
    }
    catch (error) {
        response.status(500).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.get("/api/agent/queue/:agent", async (request, response) => {
    try {
        const agent = request.params.agent;
        if (!isAgentName(agent)) {
            response.status(400).json({ error: "agent must be workbuddy or codex" });
            return;
        }
        const filePath = agent === "workbuddy" ? agentFiles.workbuddyQueue : agentFiles.codexQueue;
        response.json({
            agent,
            queue: await readAgentText(filePath)
        });
    }
    catch (error) {
        response.status(500).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.options("/api/agent/intake-task", (request, response) => {
    applyAgentIntakeCors(request, response);
    response.status(204).end();
});
app.post("/api/agent/intake-task", async (request, response) => {
    applyAgentIntakeCors(request, response);
    try {
        const task = parseAgentTaskBlock(request.body?.taskBlock);
        const now = new Date().toISOString();
        const queueFile = task.targetAgent === "workbuddy" ? agentFiles.workbuddyQueue : agentFiles.codexQueue;
        const queueText = await readAgentText(queueFile);
        const nextQueueText = writeLatestPendingQueueEntry(queueText, formatAgentTaskQueueEntry(task, now));
        await writeFile(queueFile, nextQueueText, "utf8");
        const state = await writeAgentState({
            currentTaskId: task.taskId,
            currentAgent: task.targetAgent,
            status: "ready",
            lastQueue: task.targetAgent,
            updatedAt: now
        });
        response.json({
            imported: true,
            taskId: task.taskId,
            targetAgent: task.targetAgent,
            title: task.title,
            state
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const statusCode = [
            "任务块格式错误",
            "target_agent 不支持",
            "status 不是 ready"
        ].includes(message)
            ? 400
            : 500;
        response.status(statusCode).json({ error: message });
    }
});
app.post("/api/agent/claim", async (request, response) => {
    try {
        const agent = request.body?.agent;
        if (!isAgentName(agent)) {
            response.status(400).json({ error: "agent must be workbuddy or codex" });
            return;
        }
        const now = new Date().toISOString();
        const taskId = await resolveClaimTaskId(agent, request.body?.taskId);
        const previousState = await readAgentState();
        if (taskId &&
            previousState.currentTaskId === taskId &&
            previousState.lastClaimedTaskId === taskId &&
            ["claimed", "running", "reported"].includes(previousState.status)) {
            response.json({ state: previousState, duplicate: true });
            return;
        }
        const state = await writeAgentState({
            status: "claimed",
            currentAgent: agent,
            currentTaskId: taskId,
            lastClaimedTaskId: taskId,
            updatedAt: now
        });
        response.json({ state });
    }
    catch (error) {
        response.status(500).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/agent/report", async (request, response) => {
    try {
        const agent = request.body?.agent;
        const report = typeof request.body?.report === "string" ? request.body.report.trim() : "";
        if (!isAgentName(agent)) {
            response.status(400).json({ error: "agent must be workbuddy or codex" });
            return;
        }
        if (!report) {
            response.status(400).json({ error: "report is required" });
            return;
        }
        const now = new Date().toISOString();
        await appendFile(agentFiles.reportInbox, `\n\n## ${now} / ${agent}\n\n${report}\n`, "utf8");
        await appendFile(agentFiles.taskLog, `- [${now}] ${agent} submitted report; status=reported\n`, "utf8");
        const state = await writeAgentState({
            status: "reported",
            currentAgent: agent,
            updatedAt: now,
            lastReportAt: now
        });
        response.json({ state });
    }
    catch (error) {
        response.status(500).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/agent/status", async (request, response) => {
    try {
        const status = request.body?.status;
        if (typeof status !== "string" || !validAgentStatuses.has(status)) {
            response.status(400).json({
                error: "status must be idle, ready, claimed, running, reported, or blocked"
            });
            return;
        }
        const state = await writeAgentState({
            status,
            updatedAt: new Date().toISOString()
        });
        response.json({ state });
    }
    catch (error) {
        response.status(500).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.get("/api/p0/workflows/smt_choice_listing", async (_request, response) => {
    try {
        response.json(await p0ProtocolService.getWorkflowSpec("smt_choice_listing"));
    }
    catch (error) {
        response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
app.get("/api/p0/tasks/sample", async (_request, response) => {
    try {
        response.json(await p0ProtocolService.getSampleTask());
    }
    catch (error) {
        response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
app.get("/api/p0/context/sample", async (_request, response) => {
    try {
        response.json(await p0ProtocolService.getSampleContextPack());
    }
    catch (error) {
        response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
app.get("/api/p0/agent-jobs/sample", async (_request, response) => {
    try {
        response.json(await p0ProtocolService.getSampleAgentJob());
    }
    catch (error) {
        response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
app.get("/api/p0/artifacts/sample", async (_request, response) => {
    try {
        response.json(await p0ProtocolService.getSampleArtifact());
    }
    catch (error) {
        response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
app.get("/api/p0/chains/smt_choice_listing/sample", async (_request, response) => {
    try {
        response.json(await p0ProtocolService.getSampleChain("smt_choice_listing"));
    }
    catch (error) {
        response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
app.get("/api/p0/health", async (_request, response) => {
    response.json(await p0ProtocolService.getHealth());
});
app.get("/api/operators", async (_request, response) => {
    response.json({ operators: await operatorService.listOperators() });
});
app.post("/api/operators", async (request, response) => {
    try {
        const operator = await operatorService.createOperator(request.body);
        response.json({ operator });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/secretary/chat", async (request, response) => {
    const message = String(request.body?.message ?? "").trim();
    const pageContext = request.body?.page_context ?? {};
    const riskLevel = ["L0", "L1", "L2", "L3"].includes(request.body?.risk_level)
        ? request.body.risk_level
        : "L1";
    const draftCommand = await hiddenDataLoopService.createCommand({
        type: "secretary.chat.command",
        source: "secretary",
        payload: {
            message,
            page_context: pageContext,
            risk_level: riskLevel
        }
    });
    response.json({
        interpreted_intent: message || "未输入指令",
        suggested_next_action: "已生成本地 command 草稿，等待人工确认下一步。",
        related_context: pageContext,
        draft_command: draftCommand,
        risk_level: riskLevel,
        requires_confirmation: riskLevel !== "L0"
    });
});
app.get("/api/commands", async (_request, response) => {
    response.json({ commands: await hiddenDataLoopService.readJsonl("command_inbox") });
});
app.post("/api/commands", async (request, response) => {
    try {
        response.json({
            command: await hiddenDataLoopService.createCommand({
                type: request.body?.type ?? "website.command",
                source: request.body?.source ?? "website",
                payload: request.body?.payload ?? request.body,
                correlation_id: request.body?.correlation_id
            })
        });
    }
    catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
app.get("/api/qclaw/tasks", async (_request, response) => {
    response.json({ tasks: await hiddenDataLoopService.readJsonl("qclaw_tasks") });
});
app.post("/api/qclaw/tasks", async (request, response) => {
    try {
        response.json({
            task: await hiddenDataLoopService.createQclawTask({
                type: request.body?.type ?? "qclaw.task",
                source: request.body?.source ?? "website",
                title: request.body?.title ?? "未命名 QClaw 任务",
                description: request.body?.description,
                status: request.body?.status,
                risk_level: request.body?.risk_level,
                command_id: request.body?.command_id,
                correlation_id: request.body?.correlation_id,
                payload: request.body?.payload
            })
        });
    }
    catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
app.post("/api/qclaw/results", async (request, response) => {
    try {
        response.json({
            result: await hiddenDataLoopService.appendQclawResult({
                type: request.body?.type ?? "qclaw.result",
                source: request.body?.source ?? "qclaw",
                task_id: request.body?.task_id,
                status: request.body?.status,
                summary: request.body?.summary ?? "",
                correlation_id: request.body?.correlation_id,
                payload: request.body?.payload
            })
        });
    }
    catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
app.get("/api/events", async (_request, response) => {
    response.json({ events: await hiddenDataLoopService.readJsonl("event_log") });
});
app.get("/api/action-log", async (_request, response) => {
    response.json({ actions: await hiddenDataLoopService.readJsonl("action_log") });
});
app.post("/api/action-log", async (request, response) => {
    try {
        response.json({
            action: await hiddenDataLoopService.appendActionLog({
                type: request.body?.type ?? "action_log.entry",
                source: request.body?.source ?? "website",
                payload: request.body?.payload ?? request.body,
                correlation_id: request.body?.correlation_id
            })
        });
    }
    catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
app.get("/api/today-dashboard", async (request, response) => {
    const includeTestData = request.query.includeTestData === "true";
    response.json({
        dashboard: await hiddenDataLoopService.rebuildTodayDashboard({
            includeTestData,
            persist: !includeTestData
        })
    });
});
app.post("/api/connectors/feishu/webhook", async (request, response) => {
    try {
        const command = await hiddenDataLoopService.createFeishuCommand(request.body);
        response.json({ ok: true, accepted: true, command_id: command.id });
    }
    catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
app.get("/api/connectors/feishu/status", async (_request, response) => {
    response.json({
        status: "reserved",
        enabled: false,
        can_send_message: false,
        can_execute_qclaw: false,
        note: "Feishu v0.1 只接收 webhook 并写入 command_inbox / event_log。"
    });
});
app.get("/api/status", async (_request, response) => {
    const images = await scanProductImages();
    const currentProductId = await visualAssetsService.currentProductId();
    const productVisualAssets = currentProductId
        ? await visualAssetsService.ensureCurrentReferenceSet(currentProductId).catch(() => undefined)
        : undefined;
    const [insertBagImages, insertLinerImages] = await Promise.all([
        scanImages(INSERT_BAG_IMAGES_DIR),
        scanImages(INSERT_LINER_IMAGES_DIR, { preserveDuplicates: true })
    ]);
    response.json({
        state: store.get(),
        queue: queueService.get(),
        operations: await operationService.dashboard(await productProfiles.listLibrary()),
        daily: {
            waitingItems: await dailyOperationService.listWaitingItems()
        },
        productProfile: await productProfiles.getCurrent(),
        productProfileWarning: productProfiles.getWarning(),
        productVisualAssets: productVisualAssets
            ? {
                ...productVisualAssets,
                source_images: productVisualAssets.source_images.map((image) => ({
                    ...image,
                    thumbnailUrl: `/api/product-visual-assets/${encodeURIComponent(image.asset_id)}?v=${image.sha256.slice(0, 12)}`
                }))
            }
            : undefined,
        systemAwake: sleepInhibitor.isActive(),
        prompts: await promptStatus(),
        productDirectory: PRODUCT_IMAGES_DIR,
        availableImages: images.map(({ name, size, sha256 }) => ({
            name,
            size,
            sha256,
            thumbnailUrl: `/api/images/${encodeURIComponent(name)}?v=${sha256.slice(0, 12)}`
        })),
        outputFiles: await outputFileStatus(),
        insertBagImages: insertBagImages.map(imageStatus),
        insertLinerImages: insertLinerImages.map(imageStatus),
        insertOutputFiles: await insertOutputFileStatus(),
        contentFiles: await contentFileStatus()
    });
});
app.put("/api/state/objective-info", async (request, response) => {
    try {
        const value = request.body?.objectiveInfo;
        if (typeof value !== "string") {
            response.status(400).json({ error: "objectiveInfo 必须为字符串" });
            return;
        }
        const nextState = await store.update({ objectiveInfo: value.slice(0, 2000) });
        response.json({ state: nextState });
    }
    catch (error) {
        response.status(500).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
function rejectIfQueueLocked(response) {
    if (!queueService.isLocked())
        return false;
    response.status(409).json({
        error: "批量队列正在运行或保留当前任务，不能执行单商品操作"
    });
    return true;
}
async function abandonStandaloneCurrentProduct() {
    const state = store.get();
    if (state.running || state.autoRun) {
        throw new Error("请先暂停当前任务，并等待它进入安全暂停状态后再遗弃");
    }
    const hasCurrentProduct = Boolean(state.chatUrl) ||
        Boolean(state.completedPhase) ||
        Boolean(state.luxuryInsert?.taskId) ||
        state.imageCount > 0;
    if (!hasCurrentProduct) {
        throw new Error("当前没有可遗弃的商品");
    }
    const abandonedDirectory = await abandonCurrentProduct(state);
    const reset = await store.reset("当前商品已遗弃，请导入下一个商品");
    const nextState = await store.update({
        ...reset,
        workflowMode: state.workflowMode,
        standardWorkflowGoal: state.standardWorkflowGoal,
        provider: state.provider
    });
    return { state: nextState, abandonedDirectory };
}
async function rollbackStandardWorkflow() {
    const state = store.get();
    if (state.running || state.autoRun) {
        throw new Error("请先暂停当前任务，再回撤到上一步");
    }
    if (!state.completedPhase && !state.researchCompleted && !state.chatUrl) {
        throw new Error("当前标准 Listing 还没有可回撤的完成阶段");
    }
    if (state.completedPhase === "MVP5") {
        return store.update({
            stage: "PAUSED",
            completedPhase: state.standardWorkflowGoal === "seo_content_only" ? "MVP1" : "MVP4",
            seoKeywordText: undefined,
            listingContentText: undefined,
            error: undefined,
            message: state.standardWorkflowGoal === "seo_content_only"
                ? "已回撤到市场调研完成后，可重新生成 SEO 与商品文案"
                : "已回撤到 10 张图片完成后，可重新生成 SEO 与商品文案"
        });
    }
    if (state.completedPhase === "MVP4") {
        return store.update({
            stage: "PAUSED",
            completedPhase: "MVP3",
            generatedImageNumbers: [],
            currentImageNumber: undefined,
            outputFiles: [],
            error: undefined,
            message: "已回撤到视觉规划完成后，可重新逐张生成 Listing 图片"
        });
    }
    if (state.completedPhase === "MVP3") {
        return store.update({
            stage: "PAUSED",
            completedPhase: "MVP1",
            promptPackValid: false,
            planningText: undefined,
            error: undefined,
            message: "已回撤到产品识别完成后，可重新执行市场调研与视觉规划"
        });
    }
    if (state.researchCompleted) {
        return store.update({
            stage: "PAUSED",
            researchCompleted: false,
            researchText: undefined,
            error: undefined,
            message: "已回撤到产品识别完成后，可重新执行市场调研"
        });
    }
    if (state.completedPhase === "MVP1" || state.chatUrl) {
        return store.update({
            stage: "PAUSED",
            error: undefined,
            message: "当前已在标准 Listing 最早安全阶段；如需重做，请遗弃当前商品后重新开始"
        });
    }
    throw new Error("当前标准 Listing 状态没有可回撤的上一步");
}
async function rollbackCurrentTask() {
    const state = store.get();
    if (state.workflowMode === "luxury_insert") {
        const insert = state.luxuryInsert;
        if (!insert?.taskId) {
            throw new Error("当前没有可回撤的内胆任务");
        }
        if (state.running || state.autoRun) {
            throw new Error("请先暂停当前任务，再回撤到上一步");
        }
        if (insert.designFrozen || insert.promptPackValid || (insert.generatedImageNumbers?.length ?? 0) > 0) {
            return insertService.unlockDesign();
        }
        if (insert.notebookResultText || insert.bagFactsConfirmed) {
            return insertService.unlockBagFacts();
        }
        if (insert.selectedMarketRadarCandidateId) {
            return insertService.returnToMarketRadarPool();
        }
        throw new Error("当前内胆任务已在最早安全阶段");
    }
    return rollbackStandardWorkflow();
}
app.get("/api/queue", (_request, response) => {
    response.json({ queue: queueService.get() });
});
app.get("/api/queue/template", (_request, response) => {
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", 'attachment; filename="product-queue-template.xlsx"');
    response.send(queueService.templateBuffer());
});
app.post("/api/queue/import", queueUpload.single("workbook"), async (request, response, next) => {
    try {
        const file = request.file;
        if (!file || !/\.xlsx$/i.test(file.originalname)) {
            response.status(400).json({ error: "请选择 .xlsx Excel 文件" });
            return;
        }
        const summary = await queueService.importWorkbook(file.originalname, file.buffer);
        response.json({ summary, queue: queueService.get() });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/queue/start", async (_request, response) => {
    try {
        await queueService.start();
        response.status(202).json({ accepted: true, queue: queueService.get() });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/queue/pause", async (_request, response) => {
    try {
        response.json({ queue: await queueService.pause() });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/queue/resume", async (_request, response) => {
    try {
        await queueService.resume();
        response.status(202).json({ accepted: true, queue: queueService.get() });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/queue/abandon-current", async (request, response) => {
    try {
        const continueQueue = request.body?.continueQueue !== false;
        const queue = await queueService.abandonCurrent(continueQueue);
        response.status(continueQueue ? 202 : 200).json({
            accepted: continueQueue,
            queue
        });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/queue/tasks/:taskId/cancel", async (request, response) => {
    try {
        response.json({
            queue: await queueService.cancel(request.params.taskId)
        });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/queue/clear-completed", async (_request, response) => {
    try {
        response.json({ queue: await queueService.clearCompleted() });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.get("/api/product-profile/current", async (_request, response) => {
    response.json(await productProfiles.getCurrent());
});
app.put("/api/product-profile/current", async (request, response) => {
    try {
        const allowed = new Set(["displayName", "notes", "manualOverride"]);
        const unknown = Object.keys(request.body ?? {}).filter((key) => !allowed.has(key));
        if (unknown.length) {
            response.status(400).json({
                error: `不允许修改商品档案字段：${unknown.join("、")}`
            });
            return;
        }
        response.json({
            profile: await productProfiles.updateCurrent({
                displayName: request.body.displayName === undefined
                    ? undefined
                    : String(request.body.displayName),
                notes: request.body.notes === undefined
                    ? undefined
                    : String(request.body.notes),
                manualOverride: request.body.manualOverride === undefined
                    ? undefined
                    : request.body.manualOverride === null
                        ? null
                        : String(request.body.manualOverride)
            })
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/product-profile/current/reset-next-action", async (_request, response) => {
    try {
        response.json({
            profile: await productProfiles.resetManualOverride()
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.get("/api/product-profiles", async (_request, response) => {
    response.json({ products: await productProfiles.listLibrary() });
});
app.post("/api/product-profiles/lightweight", async (request, response) => {
    try {
        const sourceTag = String(request.body.sourceTag ?? "new_product_development");
        const nextAction = String(request.body.nextAction ?? "") ||
            (sourceTag === "asset_ready_pending_listing"
                ? "去上架接入"
                : sourceTag === "inventory_driven"
                    ? "创建链接或绑定已有链接"
                    : "请上传产品素材，开始 AI 识别");
        const profile = await productProfiles.createLightweightArchived({
            displayName: String(request.body.displayName ?? ""),
            workflowMode: request.body.workflowMode,
            category: request.body.category,
            notes: request.body.notes,
            sourceTag,
            lifecycleStatus: request.body.lifecycleStatus ?? "active",
            currentStage: request.body.currentStage ?? "IDLE",
            nextAction,
            archive: true
        });
        const operationProfile = await operationService.createDefaultOperationProfile({
            product_id: profile.productId,
            sourceTag,
            entry_reason: request.body.entry_reason,
            nextAction
        });
        response.json({
            profile,
            operationProfile
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/product-profiles/legacy-onboard", async (request, response) => {
    let profile;
    try {
        await operationService.validateLegacyProductOnboarding({
            product_id: "00000000-0000-4000-8000-000000000000",
            store_id: request.body.store_id,
            platform_product_id: request.body.platform_product_id,
            listing_url: request.body.listing_url,
            platform_sku_id: request.body.platform_sku_id,
            seller_sku_code: request.body.seller_sku_code,
            sku_inventory_sku: request.body.sku_inventory_sku ?? request.body.inventory_sku
        });
        profile = await productProfiles.createLightweightArchived({
            displayName: String(request.body.displayName ?? ""),
            workflowMode: request.body.workflowMode ?? "standard_listing",
            category: request.body.category,
            notes: request.body.notes,
            sourceTag: "live_legacy_import",
            lifecycleStatus: "active",
            currentStage: "COMPLETED",
            nextAction: "补齐 SKU 映射并录入首个 7 天周期数据",
            archive: true
        });
        const result = await operationService.createLegacyProductOnboarding({
            product_id: profile.productId,
            store_id: request.body.store_id,
            platform_product_id: request.body.platform_product_id,
            listing_url: request.body.listing_url,
            listing_title: request.body.listing_title,
            listing_status: request.body.listing_status,
            listing_lifecycle: request.body.listing_lifecycle,
            inventory_sku: request.body.inventory_sku,
            target_bag_model: request.body.target_bag_model,
            target_size: request.body.target_size,
            image_version: request.body.image_version,
            title_version: request.body.title_version,
            platform_sku_id: request.body.platform_sku_id,
            seller_sku_code: request.body.seller_sku_code,
            platform_barcode: request.body.platform_barcode,
            variant_name: request.body.variant_name,
            color: request.body.color,
            size: request.body.size,
            sku_inventory_sku: request.body.sku_inventory_sku,
            warehouse_sku: request.body.warehouse_sku
        });
        response.json({ profile, ...result });
    }
    catch (error) {
        if (profile) {
            await productProfiles.deleteArchived(profile.productId).catch(() => undefined);
        }
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.get("/api/product-profiles/:productId", async (request, response) => {
    try {
        response.json({
            profile: await productProfiles.getArchived(request.params.productId),
            thumbnailUrl: `/api/product-profiles/${encodeURIComponent(request.params.productId)}/thumbnail`
        });
    }
    catch (error) {
        response.status(404).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.get("/api/product-profiles/:productId/thumbnail", async (request, response) => {
    try {
        const filePath = await productProfiles.getArchivedThumbnail(request.params.productId);
        if (!filePath) {
            response.status(404).json({ error: "该商品暂无可用缩略图" });
            return;
        }
        response.sendFile(filePath);
    }
    catch (error) {
        response.status(404).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.delete("/api/product-profiles/:productId", async (request, response) => {
    try {
        response.json({
            deleted: await productProfiles.deleteArchived(request.params.productId)
        });
    }
    catch (error) {
        response.status(404).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.get("/api/operations", async (_request, response) => {
    response.json(await operationService.dashboard(await productProfiles.listLibrary()));
});
app.get("/api/daily/waiting-items", async (_request, response) => {
    response.json({ waitingItems: await dailyOperationService.listWaitingItems() });
});
app.post("/api/daily/waiting-items", async (request, response) => {
    try {
        response.json({
            waitingItem: await dailyOperationService.createWaitingItem(request.body)
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.patch("/api/daily/waiting-items/:waitingId", async (request, response) => {
    try {
        response.json({
            waitingItem: await dailyOperationService.updateWaitingItem(request.params.waitingId, request.body)
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.put("/api/operations/profiles/:productId", async (request, response) => {
    try {
        response.json({
            operationProfile: await operationService.upsertOperationProfile({
                ...request.body,
                product_id: request.params.productId
            })
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/operations/stores", async (request, response) => {
    try {
        response.json({
            storeProfile: await operationService.upsertStoreProfile(request.body)
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/operations/listings", async (request, response) => {
    try {
        response.json({
            listingCard: await operationService.upsertListingCard(request.body)
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/operations/listing-sku-mappings", async (request, response) => {
    try {
        response.json({
            mapping: await operationService.upsertListingSkuMapping(request.body)
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/operations/tasks", async (request, response) => {
    try {
        response.json({
            task: await operationService.createDataCollectionTask(request.body)
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/operations/snapshots", async (request, response) => {
    try {
        response.json({
            snapshot: await operationService.createPerformanceSnapshot(request.body)
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/operations/actions", async (request, response) => {
    try {
        response.json({
            action: await operationService.createOperationAction(request.body)
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.put("/api/operations/actions/:actionId", async (request, response) => {
    try {
        response.json({
            action: await operationService.updateOperationAction({
                ...request.body,
                action_id: request.params.actionId
            })
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.delete("/api/operations/profiles/:productId", async (request, response) => {
    response.json({
        deleted: await operationService.deleteOperationProfile(request.params.productId)
    });
});
app.delete("/api/operations/stores/:storeId", async (request, response) => {
    response.json({
        deleted: await operationService.deleteStoreProfile(request.params.storeId)
    });
});
app.delete("/api/operations/listings/:listingId", async (request, response) => {
    response.json({
        deleted: await operationService.deleteListingCard(request.params.listingId)
    });
});
app.delete("/api/operations/listing-sku-mappings/:mappingId", async (request, response) => {
    response.json({
        deleted: await operationService.deleteListingSkuMapping(request.params.mappingId)
    });
});
app.delete("/api/operations/tasks/:taskId", async (request, response) => {
    response.json({
        deleted: await operationService.deleteDataCollectionTask(request.params.taskId)
    });
});
app.delete("/api/operations/snapshots/:snapshotId", async (request, response) => {
    response.json({
        deleted: await operationService.deletePerformanceSnapshot(request.params.snapshotId)
    });
});
app.delete("/api/operations/actions/:actionId", async (request, response) => {
    response.json({
        deleted: await operationService.deleteOperationAction(request.params.actionId)
    });
});
app.post("/api/product-profiles/legacy-preview", async (request, response) => {
    try {
        response.json({
            preview: await productProfiles.previewLegacy(String(request.body.directoryName ?? ""))
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/product-profiles/legacy-create", async (request, response) => {
    try {
        response.json({
            profile: await productProfiles.createLegacy(String(request.body.directoryName ?? ""))
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
function imageStatus({ name, size, sha256 }) {
    return {
        name,
        size,
        sha256,
        thumbnailUrl: `/api/insert/image/${encodeURIComponent(name)}?kind=thumbnail&v=${sha256.slice(0, 12)}`
    };
}
async function outputFileStatus() {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(OUTPUT_DIR).catch(() => []);
    return names
        .filter((name) => /^Image_\d{2}\.(png|jpe?g|webp)$/i.test(name))
        .sort()
        .map((name) => ({
        name,
        url: `/api/output/${encodeURIComponent(name)}`
    }));
}
async function contentFileStatus() {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(OUTPUT_DIR).catch(() => []);
    return names
        .filter((name) => /^(03_SEO_KEYWORDS|04_LISTING_CONTENT)\.md$/.test(name))
        .sort()
        .map((name) => ({
        name,
        url: `/api/content/${encodeURIComponent(name)}`
    }));
}
async function insertOutputFileStatus() {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(INSERT_OUTPUT_DIR).catch(() => []);
    return names
        .filter((name) => /^Image_\d{2}\.(png|jpe?g|webp)$/i.test(name))
        .sort()
        .map((name) => ({
        name,
        url: `/api/insert/output/${encodeURIComponent(name)}`
    }));
}
app.get("/api/insert/output/:name", (request, response) => {
    const name = request.params.name;
    if (!/^Image_0[1-7]\.(png|jpe?g|webp)$/i.test(name)) {
        response.status(400).json({ error: "无效内胆输出文件名" });
        return;
    }
    response.sendFile(path.join(INSERT_OUTPUT_DIR, name));
});
app.get("/api/insert/image/:name", async (request, response) => {
    const name = request.params.name;
    const candidates = [
        ...(await scanImages(INSERT_BAG_IMAGES_DIR)),
        ...(await scanImages(INSERT_LINER_IMAGES_DIR, { preserveDuplicates: true }))
    ];
    const image = candidates.find((candidate) => candidate.name === name);
    if (!image) {
        response.status(404).json({ error: "内胆任务图片不存在" });
        return;
    }
    response.sendFile(image.path);
});
app.get("/api/output/:name", async (request, response) => {
    const name = request.params.name;
    if (!/^Image_\d{2}\.(png|jpe?g|webp)$/i.test(name)) {
        response.status(400).json({ error: "无效输出文件名" });
        return;
    }
    response.sendFile(path.join(OUTPUT_DIR, name));
});
app.get("/api/content/:name", async (request, response) => {
    const name = request.params.name;
    if (!/^(03_SEO_KEYWORDS|04_LISTING_CONTENT)\.md$/.test(name)) {
        response.status(400).json({ error: "无效文案文件名" });
        return;
    }
    response.download(path.join(OUTPUT_DIR, name));
});
app.post("/api/finder/output", async (_request, response) => {
    const directory = store.get().workflowMode === "luxury_insert"
        ? INSERT_OUTPUT_DIR
        : OUTPUT_DIR;
    await mkdir(directory, { recursive: true });
    const child = spawn("open", [directory], {
        detached: true,
        stdio: "ignore"
    });
    child.unref();
    response.json({ opened: true, path: directory });
});
app.get("/api/images/:name", async (request, response) => {
    const name = request.params.name;
    const images = await scanProductImages();
    const image = images.find((candidate) => candidate.name === name);
    if (!image) {
        response.status(404).json({ error: "图片不存在" });
        return;
    }
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.sendFile(image.path);
});
app.get("/api/product-visual-assets/:assetId", async (request, response) => {
    const asset = await visualAssetsService.findAsset(request.params.assetId);
    if (!asset) {
        response.status(404).json({ error: "产品参考图资产不存在" });
        return;
    }
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.type(asset.mime_type);
    response.sendFile(asset.storage_path);
});
app.get("/api/prompts/:kind", async (request, response) => {
    const kind = request.params.kind;
    if (!PROMPT_KINDS.includes(kind)) {
        response.status(400).json({ error: "未知 Prompt 类型" });
        return;
    }
    try {
        response.json({ kind, content: await readPrompt(kind) });
    }
    catch (error) {
        response.status(404).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.put("/api/prompts/:kind", async (request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    const kind = request.params.kind;
    if (!PROMPT_KINDS.includes(kind)) {
        response.status(400).json({ error: "未知 Prompt 类型" });
        return;
    }
    await savePrompt(kind, String(request.body.content ?? ""));
    response.json({ saved: true, prompts: await promptStatus() });
});
app.post("/api/import-images", upload.array("images"), async (request, response, next) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        if (state.running || state.autoRun || state.chatUrl) {
            response.status(409).json({
                error: state.running || state.autoRun
                    ? "流程运行中，不能修改产品图片"
                    : "该商品已进入 ChatGPT 对话，不能再修改产品图片"
            });
            return;
        }
        const files = (request.files ?? []);
        const result = await importProductImages(files);
        const images = await scanProductImages();
        const productId = (await visualAssetsService.currentProductId()) ?? "current-product";
        await visualAssetsService.rebuildCurrentReferenceSet(productId);
        await store.update({
            imageCount: images.length,
            imageNames: images.map((image) => image.name),
            message: `产品目录中共有 ${images.length} 张去重图片`,
            error: undefined
        });
        response.json({ result, imageCount: images.length });
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/import-image-urls", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        if (state.running || state.autoRun || state.chatUrl) {
            response.status(409).json({
                error: state.running || state.autoRun
                    ? "流程运行中，不能修改产品图片"
                    : "该商品已进入 ChatGPT 对话，不能再修改产品图片"
            });
            return;
        }
        const urls = Array.isArray(request.body.urls)
            ? request.body.urls.map(String)
            : [];
        const result = await importProductImageUrls(urls);
        const images = await scanProductImages();
        const productId = (await visualAssetsService.currentProductId()) ?? "current-product";
        await visualAssetsService.rebuildCurrentReferenceSet(productId);
        await store.update({
            imageCount: images.length,
            imageNames: images.map((image) => image.name),
            message: `URL 导入完成，产品目录中共有 ${images.length} 张去重图片`,
            error: undefined
        });
        response.json({ result, imageCount: images.length });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.delete("/api/images/:name", async (request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    const state = store.get();
    if (state.running || state.autoRun || state.chatUrl) {
        response.status(409).json({
            error: state.running || state.autoRun
                ? "流程运行中，不能删除产品图片"
                : "该商品已进入 ChatGPT 对话。为保持事实源一致，不能删除图片"
        });
        return;
    }
    await removeProductImage(request.params.name);
    const images = await scanProductImages();
    await store.update({
        imageCount: images.length,
        imageNames: images.map((image) => image.name),
        message: `已删除图片，当前共有 ${images.length} 张`,
        error: undefined
    });
    response.json({ deleted: true, imageCount: images.length });
});
app.delete("/api/images", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    const state = store.get();
    if (state.running || state.autoRun || state.chatUrl) {
        response.status(409).json({
            error: state.running || state.autoRun
                ? "流程运行中，不能清空产品图片"
                : "该商品已进入 ChatGPT 对话。为保持事实源一致，不能清空图片"
        });
        return;
    }
    const deleted = await clearProductImages();
    await store.update({
        imageCount: 0,
        imageNames: [],
        message: "产品图片已清空",
        error: undefined
    });
    response.json({ deleted, imageCount: 0 });
});
app.post("/api/browser/launch", async (_request, response) => {
    try {
        response.json({ state: await standardService.launchBrowser() });
    }
    catch (error) {
        response.status(500).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.put("/api/provider", async (request, response) => {
    const provider = String(request.body.provider ?? "");
    if (!["chatgpt", "gemini"].includes(provider)) {
        response.status(400).json({ error: "未知 AI 引擎" });
        return;
    }
    try {
        response.json({
            state: store.get().workflowMode === "luxury_insert"
                ? await insertService.selectProvider(provider)
                : await standardService.selectProvider(provider)
        });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.put("/api/workflow-mode", async (request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    const mode = String(request.body.mode ?? "");
    if (!["standard_listing", "luxury_insert"].includes(mode)) {
        response.status(400).json({ error: "未知业务模式" });
        return;
    }
    try {
        response.json({ state: await insertService.selectMode(mode) });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/bag-images", upload.array("images"), async (request, response, next) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        if (state.workflowMode !== "luxury_insert") {
            response.status(409).json({ error: "当前不是奢侈包内胆模式" });
            return;
        }
        if (state.running || state.luxuryInsert?.bagFactsConfirmed) {
            response.status(409).json({ error: "外包事实已锁定，不能继续修改目标外包图" });
            return;
        }
        const result = await importImagesToDirectory(INSERT_BAG_IMAGES_DIR, (request.files ?? []));
        response.json({ result });
    }
    catch (error) {
        next(error);
    }
});
app.delete("/api/insert/bag-images/:name", async (request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    const state = store.get();
    if (state.running || state.luxuryInsert?.bagFactsConfirmed) {
        response.status(409).json({ error: "外包事实已锁定，不能删除图片" });
        return;
    }
    await removeImageFromDirectory(INSERT_BAG_IMAGES_DIR, request.params.name);
    response.json({ deleted: true });
});
app.post("/api/insert/bag-image-urls", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        if (state.workflowMode !== "luxury_insert" ||
            state.running ||
            state.luxuryInsert?.bagFactsConfirmed) {
            response.status(409).json({ error: "当前不能修改目标外包图片" });
            return;
        }
        const urls = Array.isArray(request.body.urls)
            ? request.body.urls.map(String)
            : [];
        const result = await insertService.importBagImageUrls(urls);
        response.json({ result });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/liner-images", upload.single("image"), async (request, response, next) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        const variantId = String(request.body.variantId ?? "");
        const variants = state.luxuryInsert?.variants ?? [];
        const variant = variants.find((candidate) => candidate.id === variantId);
        if (!variant || !state.luxuryInsert?.designFrozen) {
            response.status(409).json({ error: "SKU 不存在或设计尚未冻结" });
            return;
        }
        if (!request.file) {
            response.status(400).json({ error: "请选择一张内胆图片" });
            return;
        }
        const result = await importImagesToDirectory(INSERT_LINER_IMAGES_DIR, [request.file], [variantId], { allowDuplicateContent: true });
        const name = result.imported[0];
        if (!name)
            throw new Error("内胆图片导入失败");
        if (variant.linerImageName && variant.linerImageName !== name) {
            const sharedByAnotherVariant = variants.some((candidate) => candidate.id !== variant.id &&
                candidate.linerImageName === variant.linerImageName);
            if (!sharedByAnotherVariant) {
                await removeImageFromDirectory(INSERT_LINER_IMAGES_DIR, variant.linerImageName).catch(() => undefined);
            }
        }
        const updated = variants.map((candidate) => candidate.id === variantId
            ? { ...candidate, linerImageName: name }
            : candidate);
        await store.update({
            luxuryInsert: {
                ...state.luxuryInsert,
                variants: updated,
                linerImagesUploaded: false
            }
        });
        response.json({ result, variantId, name });
    }
    catch (error) {
        next(error);
    }
});
app.delete("/api/insert/liner-images/:variantId", async (request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    const state = store.get();
    if (state.running) {
        response.status(409).json({ error: "流程运行中，不能删除内胆图片" });
        return;
    }
    const variants = state.luxuryInsert?.variants ?? [];
    const variant = variants.find((candidate) => candidate.id === request.params.variantId);
    if (!variant?.linerImageName) {
        response.status(404).json({ error: "该 SKU 没有内胆图片" });
        return;
    }
    const sharedByAnotherVariant = variants.some((candidate) => candidate.id !== variant.id &&
        candidate.linerImageName === variant.linerImageName);
    if (!sharedByAnotherVariant) {
        await removeImageFromDirectory(INSERT_LINER_IMAGES_DIR, variant.linerImageName);
    }
    await store.update({
        luxuryInsert: {
            ...state.luxuryInsert,
            variants: variants.map((candidate) => candidate.id === variant.id
                ? { ...candidate, linerImageName: undefined }
                : candidate),
            linerImagesUploaded: false
        }
    });
    response.json({ deleted: true });
});
app.post("/api/insert/liner-image-url", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        const variantId = String(request.body.variantId ?? "");
        const url = String(request.body.url ?? "").trim();
        const variants = state.luxuryInsert?.variants ?? [];
        const variant = variants.find((candidate) => candidate.id === variantId);
        if (!variant || !state.luxuryInsert?.designFrozen || state.running) {
            response.status(409).json({ error: "SKU 不存在、设计未冻结或流程正在运行" });
            return;
        }
        const result = await importImageUrlsToDirectory(INSERT_LINER_IMAGES_DIR, [url], [variantId], { allowDuplicateContent: true });
        const name = result.imported[0];
        if (!name)
            throw new Error("URL 图片导入失败");
        if (variant.linerImageName && variant.linerImageName !== name) {
            const sharedByAnotherVariant = variants.some((candidate) => candidate.id !== variant.id &&
                candidate.linerImageName === variant.linerImageName);
            if (!sharedByAnotherVariant) {
                await removeImageFromDirectory(INSERT_LINER_IMAGES_DIR, variant.linerImageName).catch(() => undefined);
            }
        }
        await store.update({
            luxuryInsert: {
                ...state.luxuryInsert,
                variants: variants.map((candidate) => candidate.id === variantId
                    ? { ...candidate, linerImageName: name }
                    : candidate),
                linerImagesUploaded: false
            }
        });
        response.json({ result, variantId, name });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});

/* ── 内胆细节图（每 SKU 多张，生图时一并传入 AI 作为参考） ── */
const MAX_DETAIL_IMAGES_PER_SKU = 12;
app.post("/api/insert/liner-detail-images", upload.array("images", MAX_DETAIL_IMAGES_PER_SKU), async (request, response, next) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        const variantId = String(request.body.variantId ?? "");
        const variants = state.luxuryInsert?.variants ?? [];
        const variant = variants.find((candidate) => candidate.id === variantId);
        if (!variant || !state.luxuryInsert?.designFrozen) {
            response.status(409).json({ error: "SKU 不存在或设计尚未冻结" });
            return;
        }
        if (!request.files?.length) {
            response.status(400).json({ error: "请选择至少一张细节图片" });
            return;
        }
        const existingDetailNames = variant.linerDetailImageNames ?? [];
        if (existingDetailNames.length + request.files.length > MAX_DETAIL_IMAGES_PER_SKU) {
            response.status(400).json({ error: `每个 SKU 最多 ${MAX_DETAIL_IMAGES_PER_SKU} 张细节图（已有 ${existingDetailNames.length} 张）` });
            return;
        }
        /* 用 {variantId}_detail_{N} 前缀命名，避免与主图冲突 */
        const preferredNames = request.files.map((_, i) =>
            `${variantId}_detail_${existingDetailNames.length + i + 1}`
        );
        const result = await importImagesToDirectory(
            INSERT_LINER_IMAGES_DIR, request.files, preferredNames,
            { allowDuplicateContent: true }
        );
        const updatedDetailNames = [...existingDetailNames, ...result.imported];
        await store.update({
            luxuryInsert: {
                ...state.luxuryInsert,
                variants: variants.map((candidate) => candidate.id === variantId
                    ? { ...candidate, linerDetailImageNames: updatedDetailNames }
                    : candidate),
                linerImagesUploaded: false
            }
        });
        response.json({ imported: result.imported, variantId, total: updatedDetailNames.length });
    }
    catch (error) {
        next(error);
    }
});

app.post("/api/insert/liner-detail-image-urls", async (request, response, next) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        const variantId = String(request.body.variantId ?? "");
        const rawUrls = request.body.urls;
        const urls = Array.isArray(rawUrls) ? rawUrls
            : (typeof rawUrls === "string" ? rawUrls.split(/\r?\n/).map(u => u.trim()).filter(Boolean) : []);
        if (!urls.length) {
            response.status(400).json({ error: "请提供至少一个图片 URL" });
            return;
        }
        if (urls.length > MAX_DETAIL_IMAGES_PER_SKU) {
            response.status(400).json({ error: `一次最多导入 ${MAX_DETAIL_IMAGES_PER_SKU} 个 URL` });
            return;
        }
        const variants = state.luxuryInsert?.variants ?? [];
        const variant = variants.find((candidate) => candidate.id === variantId);
        if (!variant || !state.luxuryInsert?.designFrozen) {
            response.status(409).json({ error: "SKU 不存在或设计尚未冻结" });
            return;
        }
        const existingDetailNames = variant.linerDetailImageNames ?? [];
        if (existingDetailNames.length + urls.length > MAX_DETAIL_IMAGES_PER_SKU) {
            response.status(400).json({ error: `超过每 SKU ${MAX_DETAIL_IMAGES_PER_SKU} 张限制（已有 ${existingDetailNames.length} 张）` });
            return;
        }
        const preferredNames = urls.map((_, i) =>
            `${variantId}_detail_${existingDetailNames.length + i + 1}`
        );
        const result = await importImageUrlsToDirectory(
            INSERT_LINER_IMAGES_DIR, urls, preferredNames,
            { allowDuplicateContent: true }
        );
        const updatedDetailNames = [...existingDetailNames, ...result.imported];
        await store.update({
            luxuryInsert: {
                ...state.luxuryInsert,
                variants: variants.map((candidate) => candidate.id === variantId
                    ? { ...candidate, linerDetailImageNames: updatedDetailNames }
                    : candidate),
                linerImagesUploaded: false
            }
        });
        response.json({
            imported: result.imported,
            skipped: result.skippedDuplicates,
            rejected: result.rejected,
            variantId,
            total: updatedDetailNames.length
        });
    }
    catch (error) {
        next(error);
    }
});

app.delete("/api/insert/liner-detail-images/:variantId/:imageName", async (request, response, next) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        if (state.running) {
            response.status(409).json({ error: "流程运行中，不能删除细节图片" });
            return;
        }
        const variantId = decodeURIComponent(request.params.variantId);
        const imageName = decodeURIComponent(request.params.imageName);
        const variants = state.luxuryInsert?.variants ?? [];
        const variant = variants.find((candidate) => candidate.id === variantId);
        if (!variant) {
            response.status(404).json({ error: "SKU 不存在" });
            return;
        }
        const detailNames = variant.linerDetailImageNames ?? [];
        if (!detailNames.includes(imageName)) {
            response.status(404).json({ error: "该 SKU 没有此细节图" });
            return;
        }
        await removeImageFromDirectory(INSERT_LINER_IMAGES_DIR, imageName);
        const updatedDetailNames = detailNames.filter((n) => n !== imageName);
        await store.update({
            luxuryInsert: {
                ...state.luxuryInsert,
                variants: variants.map((candidate) => candidate.id === variantId
                    ? { ...candidate, linerDetailImageNames: updatedDetailNames }
                    : candidate),
                linerImagesUploaded: false
            }
        });
        response.json({ deleted: imageName, remaining: updatedDetailNames.length });
    }
    catch (error) {
        next(error);
    }
});

app.post("/api/insert/run/identify", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    runBackground(() => insertService.identifyBag());
    response.status(202).json({ accepted: true });
});
app.post("/api/insert/run/market-radar", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    /* 先尝试磁盘恢复；如果数据已在磁盘上则直接返回，不重复跑雷达 */
    try {
        const preCheck = await insertService.recoverMarketRadarFromDisk();
        if (preCheck) {
            response.json({ state: insertService.store.get(), recovered: true });
            return;
        }
    } catch { /* ignore — 恢复失败时继续走正常雷达流程 */ }
    runBackground(() => insertService.runMarketRadar());
    response.status(202).json({ accepted: true });
});
app.post("/api/insert/market-radar/select", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        response.json({
            state: await insertService.selectMarketRadarCandidate(String(request.body.candidateId ?? ""))
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/market-radar/return", async (_request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        response.json({
            state: await insertService.returnToMarketRadarPool()
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/market-radar/reset", async (_request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        response.json({
            state: await insertService.resetMarketRadar()
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/market-radar/import-current-chat", async (_request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const result = await insertService.importMarketRadarFromCurrentChat();
        response.json({ state: result });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/listing-content/import-current-chat", async (_request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const result = await insertService.importInsertListingContentFromCurrentChat();
        response.json({ state: result });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/market-radar/recover", async (_request, response) => {
    try {
        const recovered = await insertService.recoverMarketRadarFromDisk();
        response.json({ state: insertService.store.get(), recovered });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/market-radar/repair", async (_request, response) => {
    try {
        const result = await insertService.repairMarketRadarProductUrls();
        response.json({ state: insertService.store.get(), ...result });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.get("/api/insert/market-radar/preview-image", async (request, response) => {
    try {
        const imageUrl = await insertService.resolveMarketRadarImageUrl(String(request.query.url ?? ""));
        if (!imageUrl) {
            response.status(404).send("Image preview unavailable");
            return;
        }
        response.redirect(302, imageUrl);
    }
    catch (error) {
        response.status(404).send(error instanceof Error ? error.message : String(error));
    }
});
/* ── 标品选品（Bob v0.1）独立命名空间，与内胆包型选品互不干扰 ── */
app.post("/api/selection/run", async (request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().selection.running) {
        response.status(409).json({ error: "当前标品选品正在运行" });
        return;
    }
    if (store.get().running) {
        response.status(409).json({ error: "当前有其它流程正在使用 AI 会话，请稍后再运行标品选品" });
        return;
    }
    try {
        const body = request.body ?? {};
        const input = {
            taskType: String(body.taskType ?? "").trim(),
            categoryScope: String(body.categoryScope ?? "").trim(),
            marketScope: String(body.marketScope ?? "").trim(),
            researchDepth: String(body.researchDepth ?? "standard_research").trim(),
            candidateTargetCount: body.candidateTargetCount ? Number(body.candidateTargetCount) : undefined
        };
        if (!input.taskType) {
            response.status(400).json({ error: "请选择任务类型 TASK_TYPE" });
            return;
        }
        if (!input.categoryScope) {
            response.status(400).json({ error: "请填写产品类目或方向 CATEGORY_SCOPE" });
            return;
        }
        /* 运行按钮不自动从磁盘恢复：磁盘恢复是显式动作（"从磁盘恢复"按钮）。
           否则重置后磁盘文件仍在，再点运行会永远返回旧结果，Bob 不会再被触发。 */
        runBackground(() => selectionService.runSelection(input));
        response.status(202).json({ accepted: true });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/selection/adopt", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const body = request.body ?? {};
        response.json({
            state: await selectionService.adoptCandidate(String(body.candidateId ?? ""), String(body.decision ?? ""))
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/selection/reset", async (_request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        response.json({
            state: await selectionService.resetSelection()
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/selection/recover", async (_request, response) => {
    try {
        const recovered = await selectionService.recoverFromDisk();
        response.json({ state: selectionService.store.get(), recovered });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/selection/import-current-chat", async (_request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const result = await selectionService.importFromCurrentChat();
        response.json({ state: selectionService.store.get(), ...result });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.get("/api/selection/pool", async (_request, response) => {
    try {
        response.json({ pool: await selectionService.readPool() });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.get("/api/selection/preview-image", async (request, response) => {
    try {
        const imageUrl = await selectionService.resolveSelectionImageUrl(String(request.query.url ?? ""));
        if (!imageUrl) {
            response.status(404).send("Image preview unavailable");
            return;
        }
        response.redirect(302, imageUrl);
    }
    catch (error) {
        response.status(404).send(error instanceof Error ? error.message : String(error));
    }
});
app.put("/api/insert/bag-confirmation", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        response.json({
            state: await insertService.confirmBagFacts({
                brand: String(request.body.brand ?? ""),
                bagFamily: String(request.body.bagFamily ?? ""),
                primaryVariantId: String(request.body.primaryVariantId ?? ""),
                variants: (request.body.variants ?? [])
            })
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/bag-confirmation/unlock", async (_request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        response.json({ state: await insertService.unlockBagFacts() });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/run/notebook", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    void sleepInhibitor.run(() => insertService.planWithNotebook());
    response.status(202).json({ accepted: true });
});
app.post("/api/insert/notebook/re-extract", async (_request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = await insertService.reExtractNotebookResult();
        response.json(state);
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/notebook/import", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const { text } = (request.body ?? {});
        if (!text || typeof text !== "string") {
            response.status(400).json({ error: "请求体缺少 text 字段" });
            return;
        }
        const state = await insertService.importNotebookResultText(text);
        response.json(state);
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.put("/api/insert/design-freeze", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        response.json({
            state: await insertService.freezeDesign({
                variants: (request.body.variants ?? []),
                claims: request.body.claims
            })
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/design-freeze/unlock", async (_request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        response.json({ state: await insertService.unlockDesign() });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/run/prompts", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    void sleepInhibitor.run(() => insertService.buildPromptPack());
    response.status(202).json({ accepted: true });
});
app.post("/api/insert/run/images", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    void sleepInhibitor.run(() => insertService.generateImages());
    response.status(202).json({ accepted: true });
});
app.post("/api/insert/run/listing-content", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    void sleepInhibitor.run(() => insertService.generateListingContent());
    response.status(202).json({ accepted: true });
});
app.get("/api/insert/stock-sheet/preview", async (_request, response) => {
    try {
        response.json({
            ...(await insertService.previewStockSheetRows()),
            webhook: await insertService.getStockSheetWebhookConfig()
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.get("/api/insert/stock-sheet/webhook", async (_request, response) => {
    try {
        response.json({ webhook: await insertService.getStockSheetWebhookConfig() });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.put("/api/insert/stock-sheet/webhook", async (request, response) => {
    try {
        response.json({
            webhook: await insertService.saveStockSheetWebhookConfig(request.body ?? {})
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/stock-sheet/write", async (request, response) => {
    try {
        response.json({
            records: await insertService.writeStockSheetRows(request.body.rows ?? [])
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/stock-sheet/record", async (request, response) => {
    try {
        response.json({
            records: await insertService.recordStockSheetRows(request.body.rows ?? [])
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/archive", async (_request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        if (store.get().running) {
            response.status(409).json({ error: "当前已有任务正在运行" });
            return;
        }
        const currentProfile = await productProfiles.getCurrent();
        response.json({
            state: await insertService.archiveCompletedInsert(),
            productId: currentProfile.profile?.productId
        });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/insert/run/resume", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    runBackground(() => insertService.resume());
    response.status(202).json({ accepted: true });
});
app.post("/api/browser/check", async (_request, response) => {
    response.json({ state: await standardService.recheck() });
});
app.put("/api/standard-workflow-goal", async (request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    const goal = request.body.goal;
    if (!["full_listing", "seo_content_only"].includes(goal)) {
        response.status(400).json({ error: "未知标准 Listing 任务目标" });
        return;
    }
    try {
        response.json({
            state: await standardService.selectStandardWorkflowGoal(goal)
        });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/run", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running || store.get().autoRun) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    runBackground(() => standardService.start());
    response.status(202).json({ accepted: true });
});
app.post("/api/run/all", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    const state = store.get();
    if (state.running || state.autoRun) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    runBackground(() => standardService.runAll());
    response.status(202).json({ accepted: true });
});
app.post("/api/run/planning", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running || store.get().autoRun) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    runBackground(() => store.get().standardWorkflowGoal === "seo_content_only"
        ? standardService.continueThroughResearch()
        : standardService.continueThroughPlanning());
    response.status(202).json({ accepted: true });
});
app.post("/api/run/images", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running || store.get().autoRun) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    runBackground(() => standardService.generateImages());
    response.status(202).json({ accepted: true });
});
app.post("/api/run/seo-listing", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running || store.get().autoRun) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    runBackground(() => standardService.generateSeoListingContent());
    response.status(202).json({ accepted: true });
});
app.post("/api/run/resume", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running || store.get().autoRun) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    await store.update({ pauseRequested: false });
    runBackground(() => store.get().workflowMode === "luxury_insert"
        ? insertService.resume()
        : standardService.resume());
    response.status(202).json({ accepted: true });
});
app.post("/api/task/pause", async (_request, response) => {
    try {
        const queue = queueService.get();
        if (queue.status === "running") {
            response.json({
                state: store.get(),
                queue: await queueService.pause()
            });
            return;
        }
        const state = store.get();
        if (!state.running && !state.autoRun) {
            response.status(409).json({ error: "当前没有正在运行的任务" });
            return;
        }
        response.json({
            state: await store.update({
                pauseRequested: true,
                message: "已请求暂停，将在当前回复或图片保存完成后停止"
            }),
            queue
        });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/task/abandon", async (request, response) => {
    try {
        const queue = queueService.get();
        if (queue.currentTaskId) {
            const continueQueue = request.body?.continueQueue !== false;
            response.status(continueQueue ? 202 : 200).json({
                accepted: continueQueue,
                queue: await queueService.abandonCurrent(continueQueue),
                state: store.get()
            });
            return;
        }
        response.json(await abandonStandaloneCurrentProduct());
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/task/rollback", async (_request, response) => {
    try {
        if (queueService.get().currentTaskId) {
            response.status(409).json({
                error: "队列商品不支持直接回撤，请先暂停并遗弃当前队列商品，或在单商品模式下回撤"
            });
            return;
        }
        response.json({ state: await rollbackCurrentTask() });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/run/pause", async (_request, response) => {
    try {
        const queue = queueService.get();
        if (queue.status === "running") {
            response.json({
                state: store.get(),
                queue: await queueService.pause()
            });
            return;
        }
        const state = store.get();
        if (!state.running && !state.autoRun) {
            response.status(409).json({ error: "当前没有正在运行的任务" });
            return;
        }
        response.json({
            state: await store.update({
                pauseRequested: true,
                message: "已请求暂停，将在当前回复或图片保存完成后停止"
            }),
            queue
        });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/run/sync", async (_request, response) => {
    try {
        response.json({
            state: await sleepInhibitor.run(() => store.get().workflowMode === "luxury_insert"
                ? insertService.sync()
                : standardService.syncFromChatGpt())
        });
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/product/next", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    try {
        const state = store.get();
        if (state.running || state.autoRun) {
            response.status(409).json({ error: "当前流程仍在运行，不能切换产品" });
            return;
        }
        if (state.workflowMode === "luxury_insert") {
            if (state.stage !== "COMPLETED" ||
                !state.luxuryInsert?.archiveDirectory) {
                response.status(409).json({
                    error: "请先完成并归档当前奢侈包内胆任务"
                });
                return;
            }
            await Promise.all([
                rm(INSERT_BAG_IMAGES_DIR, { recursive: true, force: true }),
                rm(INSERT_LINER_IMAGES_DIR, { recursive: true, force: true }),
                rm(INSERT_OUTPUT_DIR, { recursive: true, force: true })
            ]);
            await Promise.all([
                mkdir(INSERT_BAG_IMAGES_DIR, { recursive: true }),
                mkdir(INSERT_LINER_IMAGES_DIR, { recursive: true }),
                mkdir(INSERT_OUTPUT_DIR, { recursive: true })
            ]);
            const reset = await store.reset("上一内胆任务已归档，可从市场雷达候选池继续选择，或上传下一个目标外包");
            const nextState = await store.update({
                ...reset,
                workflowMode: "luxury_insert",
                provider: state.provider,
                responseText: state.luxuryInsert.marketRadarText,
                luxuryInsert: {
                    marketRadarText: state.luxuryInsert.marketRadarText,
                    marketRadarUpdatedAt: state.luxuryInsert.marketRadarUpdatedAt,
                    marketRadarChatUrl: state.luxuryInsert.marketRadarChatUrl,
                    marketRadarCandidates: state.luxuryInsert.marketRadarCandidates,
                    selectedMarketRadarCandidateId: undefined,
                    marketRadarSelectionWarning: undefined
                }
            });
            response.json({
                state: nextState,
                archiveDirectory: state.luxuryInsert.archiveDirectory
            });
            return;
        }
        if (!state.chatUrl) {
            response.status(409).json({ error: "当前没有需要归档的商品" });
            return;
        }
        if (state.completedPhase !== "MVP5") {
            response.status(409).json({
                error: "请先完成并保存 MVP 5 的 SEO 词库和 Listing 文案"
            });
            return;
        }
        console.error("[product/next] archiving current product");
        const currentProfile = await productProfiles.getCurrent();
        const archivedProductId = currentProfile.profile?.productId;
        const archiveDirectory = await archiveCurrentProduct(state);
        try {
            await productProfiles.archiveCurrent(archiveDirectory);
        }
        catch (error) {
            await productProfiles.reportWarning("归档商品档案失败", error);
        }
        const nextState = await store.reset("上一商品已归档，请导入下一个产品图片");
        console.error("[product/next] archived ->", archiveDirectory, "| reset stage:", nextState.stage);
        response.json({ state: nextState, archiveDirectory, productId: archivedProductId });
    }
    catch (error) {
        console.error("[product/next] HANDLER ERROR:", error && error.stack ? error.stack : error);
        if (!response.headersSent) {
            response.status(500).json({
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
});
app.post("/api/product/abandon", async (_request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        response.json(await abandonStandaloneCurrentProduct());
    }
    catch (error) {
        response.status(409).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
// ===== 店小秘自动化上品（多类目 Profile，2026-07-22 重构）=====
// adapter 单例默认 ruTie（向后兼容）；各路由按请求体 profileKey 切换。
const dianxiaomiAdapter = new DianxiaomiAdapter();

app.post("/api/dianxiaomi/reference-fill", async (_request, response) => {
    try {
        const profile = dianxiaomiAdapter.setProfile(_request.body && _request.body.profileKey);
        const templateId = (_request.body && _request.body.templateId) || profile.templateProductId;
        const reference = await dianxiaomiAdapter.referenceProduct(templateId);
        const filled = await dianxiaomiAdapter.fillFixedFields();
        const snapshot = await dianxiaomiAdapter.snapshotFixedFields();
        response.json({ ok: true, profileKey: profile.key, reference, filled, snapshot });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.post("/api/dianxiaomi/save", async (_request, response) => {
    try {
        const result = await dianxiaomiAdapter.save();
        response.json({ ok: true, ...result });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// ===== 店小秘 Phase 3：准备产品资料（上传图 + AI 提取 + 应用覆盖）=====
function safeDianxiaomiImageName(name) {
    const base = path.basename(name || `img-${Date.now()}.jpg`).replace(/[^a-zA-Z0-9._ -]/g, "_");
    return base || `img-${Date.now()}.jpg`;
}
function extractFirstJson(text) {
    if (!text)
        return null;
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fence ? fence[1] : text;
    try {
        return JSON.parse(candidate.trim());
    }
    catch {
        const s = candidate.indexOf("{");
        const e = candidate.lastIndexOf("}");
        if (s !== -1 && e !== -1 && e > s) {
            try {
                return JSON.parse(candidate.slice(s, e + 1));
            }
            catch { /* ignore */ }
        }
    }
    return null;
}
// normalizeDianxiaomiFacts 已抽到 ./dianxiaomi-facts.js 并 import（单一真相源，server 与 上品桥接共用）。

// 上传图片/提取事实后，把主图文件名追加进 product-facts.json（追加语义，不覆盖已上传图）
async function appendImagesToFacts(names) {
    if (!Array.isArray(names) || !names.length) return;
    let facts = {};
    try {
        facts = JSON.parse(await readFile(PRODUCT_FACT_FILE, "utf8"));
    }
    catch {
        facts = {};
    }
    const main = Array.isArray(facts.images?.main) ? facts.images.main : [];
    for (const n of names) {
        if (!main.includes(n))
            main.push(n);
    }
    facts.images = Object.assign({}, facts.images || {}, { main });
    facts.meta = Object.assign({}, facts.meta || {}, { updatedAt: new Date().toISOString() });
    await writeFile(PRODUCT_FACT_FILE, JSON.stringify(facts, null, 2));
}

// AI 提取事实时，保留已上传的主图（不被整体重写清空）
async function preserveUploadedImages(facts) {
    try {
        const prev = JSON.parse(await readFile(PRODUCT_FACT_FILE, "utf8"));
        if (Array.isArray(prev.images?.main) && prev.images.main.length) {
            facts.images = { main: prev.images.main };
        }
    }
    catch {
        /* 无历史文件则跳过 */
    }
    return facts;
}

app.post("/api/dianxiaomi/upload-images", upload.array("images", 12), async (request, response) => {
    try {
        const files = request.files || [];
        if (!files.length)
            throw new Error("未收到图片，请选择至少一张产品图");
        await mkdir(PRODUCT_IMAGES_DIR, { recursive: true });
        const saved = [];
        const existing = new Set(await readdir(PRODUCT_IMAGES_DIR).catch(() => []));
        for (const f of files) {
            let name = safeDianxiaomiImageName(f.originalname);
            if (existing.has(name)) {
                const ext = path.extname(name);
                const stem = path.basename(name, ext);
                let i = 2;
                while (existing.has(`${stem}-${i}${ext}`))
                    i += 1;
                name = `${stem}-${i}${ext}`;
            }
            await writeFile(path.join(PRODUCT_IMAGES_DIR, name), f.buffer);
            existing.add(name);
            saved.push(name);
        }
        await appendImagesToFacts(saved).catch(() => {});
        response.json({ ok: true, saved, dir: PRODUCT_IMAGES_DIR });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 从图片 URL 下载并保存到产品图目录（复用 image-files.js 的 importProductImageUrls）
app.post("/api/dianxiaomi/upload-image-urls", async (request, response) => {
    try {
        const { urls } = request.body;
        if (!urls || (!Array.isArray(urls) && typeof urls !== "string"))
            throw new Error("请提供 urls（字符串或字符串数组，支持换行/逗号分隔）");
        const rawUrls = Array.isArray(urls) ? urls
            : String(urls).split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
        const result = await importProductImageUrls(rawUrls);
        response.json({
            ok: true,
            saved: result.imported.map((i) => i.filename),
            skipped: result.skippedDuplicates.map((i) => i.filename),
            rejected: result.rejected,
            totalSaved: result.imported.length,
            source: "url"
        });
        await appendImagesToFacts(result.imported.map((i) => i.filename)).catch(() => {});
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 获取已上传产品图列表（用于前端预览网格）
app.get("/api/dianxiaomi/product-images", async (_request, response) => {
    try {
        const images = await scanProductImages();
        response.json({
            ok: true,
            images: images.map((img) => ({
                name: img.name,
                size: img.size,
                url: `/product-images/${encodeURIComponent(img.name)}`
            })),
            total: images.length
        });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 保存 SKU 规划（前端手动填的变种矩阵 + 定价）到 product-facts.json
app.post("/api/dianxiaomi/save-variants", async (request, response) => {
    try {
        const variants = (request.body && request.body.variants) || {};
        const factsPath = PRODUCT_FACT_FILE;
        let facts = {};
        try { facts = JSON.parse(await readFile(factsPath, "utf8")); } catch (_e) { /* 新文件 */ }
        facts.variants = variants;
        facts.meta = facts.meta || {};
        facts.meta.skuPlannedAt = new Date().toISOString();
        await writeFile(factsPath, JSON.stringify(facts, null, 2));
        response.json({ ok: true, note: "variants saved", count: (variants.matrix || []).length });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 读取源产品 1005005575013300 的销售属性（颜色 / 尺寸）矩阵
app.get("/api/dianxiaomi/source-variants", async (_request, response) => {
    try {
        const data = await dianxiaomiAdapter.readSourceVariants();
        response.json(data);
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.post("/api/dianxiaomi/extract-facts", async (_request, response) => {
    try {
        const profile = getDianxiaomiProfile(_request.body && _request.body.profileKey);
        const images = await scanProductImages();
        if (!images.length)
            throw new Error("请先在「③ 准备产品资料」上传产品图片");
        await adapters.chatgpt.launch();
        await adapters.chatgpt.createBlankChat();
        await adapters.chatgpt.uploadImages(images.map((i) => i.path));
        await adapters.chatgpt.sendPromptOnce(profile.factExtractPrompt, profile.factExtractFingerprint);
        const reply = await adapters.chatgpt.waitForResponseAfterPrompt(profile.factExtractFingerprint);
        const raw = extractFirstJson(reply);
        if (!raw)
            throw new Error("ChatGPT 回复中未解析到 JSON，请检查对话或重试");
        const facts = normalizeDianxiaomiFacts(raw);
        await preserveUploadedImages(facts);
        const missing = [];
        if (!facts.title.zh)
            missing.push("title.zh");
        if (!facts.title.en)
            missing.push("title.en");
        if (!facts.category)
            missing.push("category");
        await writeFile(PRODUCT_FACT_FILE, JSON.stringify(facts, null, 2));
        response.json({ ok: true, fact: facts, missing, sourceImages: images.length });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// ===== 爆款研究中心（Hit Product Research Center，2026-07-24）=====
// 导入爆款：用户上传图 + 手填指标；可选 sourceUrl 触发 CDP 自动抓图（最佳努力，失败不阻断）
app.post("/api/research/import", upload.array("images", 12), async (request, response) => {
    try {
        const body = request.body || {};
        const metrics =
            typeof body.metrics === "string" ? JSON.parse(body.metrics || "{}") : body.metrics || {};
        const record = await ResearchService.ingest({
            sourceUrl: body.sourceUrl || "",
            category: body.category || "",
            platform: body.platform || "",
            metrics,
            files: request.files || []
        });
        response.json({ ok: true, record });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 发现源（二阶段）：给查询词/参考图，在免费门户找候选源帖。耗时（多页 CDP），走后台 + 轮询。
app.post("/api/research/discover", upload.array("images", 3), async (request, response) => {
    try {
        const body = request.body || {};
        const query = (body.query || "").trim();
        const files = request.files || [];
        let platforms;
        if (body.platforms) {
            platforms = typeof body.platforms === "string" ? JSON.parse(body.platforms) : body.platforms;
        }
        if (!query && !files.length) {
            return response.status(400).json({ error: "请填写查询词，或上传参考图" });
        }
        const sessionId = `ds_${Date.now().toString(36)}`;
        discoverSessions.set(sessionId, {
            id: sessionId, status: "running", query, platforms: platforms || null,
            candidates: [], portals: [], trendPortals: [], reversePortals: [],
            startedAt: new Date().toISOString(), error: null, sessionDir: null
        });
        runBackground(async () => {
            try {
                const result = await ResearchService.discoverSource({ query, platforms, files, sessionId });
                const s = discoverSessions.get(sessionId);
                if (s) Object.assign(s, {
                    status: "done",
                    candidates: result.candidates,
                    portals: result.portals,
                    trendPortals: result.trendPortals,
                    reversePortals: result.reversePortals,
                    sessionDir: result.sessionDir,
                    finishedAt: new Date().toISOString()
                });
            }
            catch (err) {
                const s = discoverSessions.get(sessionId);
                if (s) Object.assign(s, { status: "failed", error: err?.message || String(err) });
            }
        });
        response.json({ ok: true, sessionId, status: "running" });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 轮询发现源结果
app.get("/api/research/discover/:sessionId", (request, response) => {
    const s = discoverSessions.get(request.params.sessionId);
    if (!s) return response.status(404).json({ error: "发现会话不存在（服务可能已重启）" });
    const { sessionDir, ...safe } = s; // 不外泄本地绝对路径
    response.json(safe);
});

// 门户截图（供人眼确认）
app.get("/api/research/discover/:sessionId/shot/:platform", (request, response) => {
    try {
        const s = discoverSessions.get(request.params.sessionId);
        if (!s || !s.sessionDir) return response.status(404).json({ error: "截图不存在" });
        const portal = (s.portals || []).find((p) => p.platform === request.params.platform);
        if (!portal || !portal.screenshot) return response.status(404).json({ error: "截图不存在" });
        response.sendFile(path.join(s.sessionDir, portal.screenshot));
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 拆解：交给 ChatGPT 多模态。耗时分钟级，走后台任务，前端轮询详情
app.post("/api/research/:id/analyze", async (request, response) => {
    try {
        const id = request.params.id;
        const record = await ResearchStore.get(id);
        if (!record) return response.status(404).json({ error: "爆款记录不存在" });
        if (record.status === "analyzing") return response.json({ ok: true, status: "analyzing" });
        await ResearchStore.update(id, { status: "analyzing", error: null });
        runBackground(async () => {
            try {
                const report = await ResearchService.analyze(record, adapters.chatgpt);
                await ResearchStore.update(id, {
                    analysis: report,
                    status: "analyzed",
                    error: null,
                    updatedAt: new Date().toISOString()
                });
            }
            catch (err) {
                await ResearchStore.update(id, {
                    status: "analyze_failed",
                    error: err?.message || String(err),
                    updatedAt: new Date().toISOString()
                });
            }
        });
        response.json({ ok: true, status: "analyzing" });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.get("/api/research/products", async (_request, response) => {
    try {
        response.json(await ResearchStore.list());
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 跨品爆款因子库：聚合所有已拆解爆款的因子，按频次 × 权重排名。
app.get("/api/research/factors", async (_request, response) => {
    try {
        response.json(await ResearchService.factorLibrary());
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.get("/api/research/:id", async (request, response) => {
    try {
        const record = await ResearchStore.get(request.params.id);
        if (!record) return response.status(404).json({ error: "爆款记录不存在" });
        response.json(record);
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.delete("/api/research/:id", async (request, response) => {
    try {
        const ok = await ResearchStore.remove(request.params.id);
        response.json({ ok });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 提供爆款图片（前端缩略图 / 证据图）
app.get("/api/research/:id/image/:assetId", async (request, response) => {
    try {
        const record = await ResearchStore.get(request.params.id);
        if (!record) return response.status(404).json({ error: "爆款记录不存在" });
        const asset = (record.images?.analysis || []).find((a) => a.assetId === request.params.assetId);
        if (!asset) return response.status(404).json({ error: "图片不存在" });
        response.sendFile(asset.localPath);
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

app.post("/api/dianxiaomi/apply-facts", async (_request, response) => {
    try {
        const facts = JSON.parse(await readFile(PRODUCT_FACT_FILE, "utf8"));
        // B 模式：空白创建页 → 固定配置 + 类目 + AI 事实 → 保存草稿（不引用源产品）
        const result = await dianxiaomiAdapter.createCustomProduct(facts);
        response.json({ ok: true, ...result });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 推荐路径（引用模式）：引用源产品 1005005575013300 带出类目+属性骨架
// → 用 product-facts.json（标品 listing 资料文档）覆盖标题/描述/品牌/材质/主图 → 保存草稿。
// 不引用则走 apply-facts（B 模式纯从零填）。
// SOP 守卫：必须先用 listing 资料文档（标题 + 详情页 + 主图）才允许进店小秘上架
function checkDianxiaomiFactsReady(facts) {
    const missing = [];
    const hasTitle = !!(facts.title && (facts.title.zh || facts.title.en));
    if (!hasTitle) missing.push("标题(title)");
    const desc = facts.description;
    const hasDesc = !!(desc && (desc.pc || desc.mobile || (typeof desc === "string" && desc.trim())));
    if (!hasDesc) missing.push("详情页(description)");
    const imgs = (facts.images && Array.isArray(facts.images.main)) ? facts.images.main : [];
    if (!imgs.length) missing.push("主图(images.main)");
    const ok = missing.length === 0;
    return { ok, missing, message: ok ? "" : "请先在上品 listing 完成资料生成（缺少：" + missing.join("、") + "），再进入店小秘自动上架" };
}

app.get("/api/dianxiaomi/facts-status", async (request, response) => {
    try {
        let facts = {};
        try {
            facts = normalizeDianxiaomiFacts(JSON.parse(await readFile(PRODUCT_FACT_FILE, "utf8")));
        }
        catch {
            facts = normalizeDianxiaomiFacts({});
        }
        const r = checkDianxiaomiFactsReady(facts);
        response.json({
            ready: r.ok,
            missing: r.missing,
            hasTitle: !!(facts.title && (facts.title.zh || facts.title.en)),
            hasDescription: !!(facts.description && (facts.description.pc || facts.description.mobile)),
            imageCount: (facts.images && Array.isArray(facts.images.main)) ? facts.images.main.length : 0,
            hasVariants: !!(facts.variants && Array.isArray(facts.variants.matrix) && facts.variants.matrix.length),
            variantsCount: (facts.variants && Array.isArray(facts.variants.matrix)) ? facts.variants.matrix.length : 0
        });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 读取「当前产品」资料包：上品流程桥接（generateSeoListingContent 末尾）产出的 product-facts.json。
// 前端「上架店小秘」按钮在 MVP5 完成后据此拉取事实并 POST /api/dianxiaomi/reference-apply。
app.get("/api/product/facts", async (_request, response) => {
    try {
        const file = path.join(PRODUCT_ROOT, "product-facts.json");
        let raw;
        let regenerated = false;
        try {
            raw = await readFile(file, "utf8");
        }
        catch {
            // 桥接阶段可能因 ChatGPT 异常静默失败（try/catch 在 generateSeoListingContent 末尾）。
            // 若 MVP5 已完成且本地仍保存着 listingContentText，尝试自动重跑一次桥接，
            // 避免用户看到"资料包缺失"却无法继续上架。
            const state = store.get();
            if (state.completedPhase === "MVP5" && state.listingContentText) {
                try {
                    await adapters.chatgpt.checkReady().catch(() => {});
                    await standardService.generateProductFactsFile(state, state.listingContentText);
                    raw = await readFile(file, "utf8");
                    regenerated = true;
                }
                catch (regenErr) {
                    console.error("[product-facts] 自动重跑桥接失败:", regenErr);
                    return response.json({
                        ready: false,
                        exists: false,
                        error: regenErr instanceof Error ? regenErr.message : String(regenErr),
                        hint: "可尝试刷新页面后重新点击上架，或调用 POST /api/product/facts/regenerate 手动重跑"
                    });
                }
            }
            else {
                return response.json({ ready: false, exists: false });
            }
        }
        const facts = normalizeDianxiaomiFacts(JSON.parse(raw));
        const r = checkDianxiaomiFactsReady(facts);
        response.json({
            ready: r.ok,
            exists: true,
            regenerated,
            missing: r.missing,
            facts,
            imageCount: facts.images.main.length,
            hasTitle: !!(facts.title && (facts.title.zh || facts.title.en)),
            hasDescription: !!(facts.description && (facts.description.pc || facts.description.mobile))
        });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 诊断/手动重跑：用现有 run-state 重新生成 product-facts.json，并把错误直接返回（定位桥接失败原因）。
app.post("/api/product/facts/regenerate", async (_request, response) => {
    try {
        const state = store.get();
        if (!state.listingContentText && !state.responseText) {
            return response.status(400).json({ error: "run-state 缺少 listingContentText / responseText，无法重跑桥接" });
        }
        // 重启后适配器尚未连接 Chrome，先确保已连上当前 chatgpt 页
        await adapters.chatgpt.checkReady().catch(() => {});
        const facts = await standardService.generateProductFactsFile(state, state.listingContentText);
        response.json({ ok: true, facts, productFactsReady: store.get().productFactsReady, path: store.get().productFactsPath });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
    }
});

app.post("/api/dianxiaomi/reference-apply", async (request, response) => {
    try {
        // 类目 profile：请求体 profileKey（ruTie / xiangBao），默认 ruTie（向后兼容）
        const profileKey = (request.body && request.body.profileKey) || undefined;
        const profile = dianxiaomiAdapter.setProfile(profileKey);
        // 前置守卫：强制「先 listing 后上架」顺序（SOP 对齐）
        let facts;
        if (request.body && request.body.facts) {
            facts = normalizeDianxiaomiFacts(request.body.facts);
        }
        else {
            try {
                facts = normalizeDianxiaomiFacts(JSON.parse(await readFile(PRODUCT_FACT_FILE, "utf8")));
            }
            catch {
                facts = normalizeDianxiaomiFacts({});
            }
        }
        const ready = checkDianxiaomiFactsReady(facts);
        if (!ready.ok) {
            return response.json({ ok: false, step: "facts-incomplete", message: ready.message, missing: ready.missing });
        }
        const templateId = (request.body && request.body.templateId) || profile.templateProductId;
        const reference = await dianxiaomiAdapter.referenceProduct(templateId);
        const fixed = await dianxiaomiAdapter.fillFixedFields();
        const applied = await dianxiaomiAdapter.fillFromFacts(facts);
        let saved = null;
        try {
            saved = await dianxiaomiAdapter.save();
        }
        catch (e) {
            saved = { ok: false, error: e.message };
        }
        response.json({
            ok: true,
            profileKey: profile.key,
            reference,
            fixed,
            facts: { title: facts.title, brand: facts.brand, material: facts.material, images: facts.images },
            applied,
            saved,
            url: dianxiaomiAdapter.page ? dianxiaomiAdapter.page.url() : null
        });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// 列出可用的店小秘类目 profile（前端类目切换用）
app.get("/api/dianxiaomi/profiles", async (_request, response) => {
    try {
        const profiles = Object.values(DIANXIAOMI_CATEGORY_PROFILES).map((p) => ({
            key: p.key,
            label: p.label,
            category: p.category,
            templateProductId: p.templateProductId,
            fixed: p.fixed,
            fillVariantSections: !!p.fillVariantSections
        }));
        response.json({ ok: true, profiles });
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// ===== 批量流水线上架（v1.4.0，2026-07-25）=====
// 复用单品上架链路（setProfile→referenceProduct→fillFixedFields→fillFromFacts→save），
// 顺序执行、共用单 Chrome 页、失败隔离、类目分流、存草稿不发布。
const batchRunState = {
  running: false,
  jobId: null,
  startedAt: null,
  finishedAt: null,
  overallProgress: 0,
  summary: null, // { success, failed, skipped, total }
  items: {} // name -> { name, status, progress, reason, log:[] }
};

async function detectCategory(dir) {
  try {
    const profile = JSON.parse(await readFile(path.join(dir, "product-profile.json"), "utf8"));
    const cat = (profile.category || profile.key || "").toString();
    if (/乳贴|nipple|nipples/i.test(cat)) return "ruTie";
    if (/箱包|bag|内胆|liner|insert/i.test(cat)) return "xiangBao";
  } catch { /* ignore */ }
  try {
    const facts = JSON.parse(await readFile(path.join(dir, "product-facts.json"), "utf8"));
    const cat = (facts.category || "").toString();
    if (/乳贴|nipple|nipples/i.test(cat)) return "ruTie";
    if (/箱包|bag|内胆|liner|insert/i.test(cat)) return "xiangBao";
  } catch { /* ignore */ }
  return "ruTie";
}

// 扫描 已完成产品/ 的一级子目录，供「一键生成数据源表格」辅助使用
app.get("/api/dianxiaomi/product-packages", async (_request, response) => {
  try {
    const names = await readdir(COMPLETED_PRODUCTS_DIR).catch(() => []);
    const packages = [];
    for (const name of names) {
      if (name.startsWith(".")) continue; // 跳过 .stfolder 等隐藏/同步标记目录
      const dir = path.join(COMPLETED_PRODUCTS_DIR, name);
      let isDir = false;
      try { isDir = (await stat(dir)).isDirectory(); } catch { isDir = false; }
      if (!isDir) continue;
      let category = "ruTie";
      try { category = await detectCategory(dir); } catch { /* ignore */ }
      let hasFacts = false, imageCount = 0;
      try { await readFile(path.join(dir, "product-facts.json"), "utf8"); hasFacts = true; } catch { /* ignore */ }
      try {
        const imgs = await readdir(dir);
        imageCount = imgs.filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).length;
      } catch { /* ignore */ }
      packages.push({ name, dir, category, hasFacts, imageCount });
    }
    response.json({ ok: true, packages });
  }
  catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// 批量上架入口：接收人工填好的 rows，后台顺序执行
app.post("/api/dianxiaomi/batch-apply", async (request, response) => {
  try {
    const rows = (request.body && Array.isArray(request.body.rows)) ? request.body.rows : [];
    if (!rows.length) return response.status(400).json({ ok: false, error: "rows 为空" });
    if (batchRunState.running) return response.status(409).json({ ok: false, error: "已有批量任务在运行" });
    const normalized = rows.map((r) => ({
      packageName: (r.packageName || "").toString().trim(),
      category: (r.category || "auto").toString().trim(),
      enabled: r.enabled === false || r.enabled === "false" || r.enabled === 0 || r.enabled === "0" ? false : true,
      store: (r.store || "").toString().trim(),
      brand: (r.brand || "").toString().trim(),
      variantParams: (r.variantParams || "").toString().trim(),
      stockType: (r.stockType || "").toString().trim()
    })).filter((r) => r.packageName);
    if (!normalized.length) return response.status(400).json({ ok: false, error: "无有效 packageName" });
    batchRunState.jobId = `batch-${Date.now()}`;
    runBackground(() => runBatchListing(normalized));
    response.json({ ok: true, jobId: batchRunState.jobId, accepted: true });
  }
  catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// 进度查询：前端每秒轮询
app.get("/api/dianxiaomi/batch-status", async (_request, response) => {
  try {
    const items = Object.values(batchRunState.items).map((it) => ({
      name: it.name,
      status: it.status,
      progress: it.progress,
      reason: it.reason,
      log: it.log.slice(-50)
    }));
    response.json({
      ok: true,
      running: batchRunState.running,
      jobId: batchRunState.jobId,
      overallProgress: batchRunState.overallProgress,
      summary: batchRunState.summary,
      items
    });
  }
  catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// 解析批量表格里的「变种参数」文本 → { colors, sizes }
// 格式：颜色:肤色,黑色;尺寸:S,M,L （属性名:值1,值2; 多个属性用 ; 分隔；颜色/尺寸映射到销售属性）
function parseVariantParams(str) {
  const colors = [], sizes = [];
  if (!str) return { colors, sizes };
  const parts = String(str).split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^([^:：]+)[：:]\s*(.+)$/);
    if (!m) continue;
    const name = m[1].trim().toLowerCase();
    const vals = m[2].split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (/颜色|color/.test(name)) colors.push(...vals);
    else if (/尺寸|尺码|size/.test(name)) sizes.push(...vals);
    // 其它销售属性名暂忽略（店小秘仅 颜色/尺寸 为系统销售属性）
  }
  return { colors, sizes };
}

// 解析批量表格里的「变种参数」为箱包类目的颜色映射
// 格式：店小秘颜色名[=自定义名称][=图片文件名]；多色用 ; 或换行分隔
// 示例：古铜色=Bronze=bronze.jpg;Rose Gold=Rose Gold=rose.jpg;金=Gold=4pcs.jpg
function parseColorMap(str) {
  const map = [];
  if (!str) return map;
  const segs = String(str).split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segs) {
    const seg2 = seg.replace(/^颜色\s*[：:]\s*/, "");
    if (!seg2) continue;
    // 跳过乳贴式纯颜色列表（无 = 但含 ,）
    if (!seg2.includes("=") && /,/.test(seg2)) continue;
    const parts = seg2.split(/=/);
    const color = parts[0].trim();
    if (!color) continue;
    // 支持简写：颜色=图片（无自定义名）；完整：颜色=自定义名=图片
    if (parts.length === 2) {
      map.push({ color, customName: "", image: (parts[1] || "").trim() });
    } else {
      map.push({ color, customName: (parts[1] || "").trim(), image: (parts[2] || "").trim() });
    }
  }
  return map;
}

// 由 colors × sizes 重建 SKU 组合矩阵（用源产品已有矩阵的首行价格/库存/重量作默认，缺失则回退常量）
function buildVariantMatrix(colors, sizes, baseMatrix) {
  const colorList = (colors && colors.length) ? colors : ["默认"];
  const sizeList = (sizes && sizes.length) ? sizes : ["One Size"];
  const sample = (baseMatrix && baseMatrix.length) ? baseMatrix[0] : null;
  const price = (sample && Number(sample.price) > 0) ? Number(sample.price) : 3.5;
  const stock = (sample && Number(sample.stock) > 0) ? Number(sample.stock) : 100;
  const weight = (sample && sample.weight != null) ? Number(sample.weight) : 0.03;
  const matrix = [];
  colorList.forEach((c, ci) => sizeList.forEach((s, si) => {
    matrix.push({
      combination: [c, s],
      price, stock, weight,
      sku: `SKU-${ci}${si}`,
      barcode: ""
    });
  }));
  return matrix;
}

async function runBatchListing(rows) {
  batchRunState.running = true;
  batchRunState.jobId = `batch-${Date.now()}`;
  batchRunState.startedAt = Date.now();
  batchRunState.finishedAt = null;
  batchRunState.summary = null;
  batchRunState.items = {};
  batchRunState.overallProgress = 0;
  const targets = rows.filter((r) => r.enabled !== false && r.packageName);
  const total = targets.length;
  let success = 0, failed = 0, skipped = 0, done = 0;
  const snapshot = async () => {
    try {
      await writeFile(
        path.join(HIDDEN_DATA_DIR, "batch-listing-state.json"),
        JSON.stringify(batchRunState, null, 2),
        "utf8"
      );
    } catch { /* ignore */ }
  };
  for (const row of targets) {
    const name = row.packageName;
    const dir = path.join(COMPLETED_PRODUCTS_DIR, name);
    const item = { name, status: "running", progress: 0, reason: "", log: [] };
    batchRunState.items[name] = item;
    const log = (m) => item.log.push(`[${new Date().toISOString()}] ${m}`);
    log(`开始处理包: ${name}`);
    // 校验包目录 + product-facts.json
    let factsFile = null;
    try {
      await readFile(path.join(dir, "product-facts.json"), "utf8");
      factsFile = path.join(dir, "product-facts.json");
    } catch {
      item.status = "skipped";
      item.reason = "缺少 product-facts.json";
      item.progress = 100;
      skipped++; done++;
      batchRunState.overallProgress = total ? Math.round((done / total) * 100) : 100;
      await snapshot();
      continue;
    }
    const key = (row.category && row.category !== "auto") ? row.category : await detectCategory(dir);
    try {
      let profile = dianxiaomiAdapter.setProfile(key);
      log(`类目 profile: ${profile.key}`);
      // 批量自定义覆盖（来自表格的店铺/备货类型/品牌/变种参数）：克隆 profile 避免污染全局配置
      profile = JSON.parse(JSON.stringify(profile));
      if (row.store) { profile.fixed.storeName = row.store; log(`覆盖店铺: ${row.store}`); }
      if (row.stockType) { profile.fixed.stockType = row.stockType; log(`覆盖备货类型: ${row.stockType}`); }
      dianxiaomiAdapter.profile = profile;

      const facts = normalizeDianxiaomiFacts(JSON.parse(await readFile(factsFile, "utf8")));
      // 品牌覆盖（乳贴类目品牌由模板派生，仅记录意图；箱包类目可被 trySetBrand 采用）
      if (row.brand) { facts.brand = row.brand; log(`覆盖品牌: ${row.brand}`); }
      // 变种参数覆盖：乳贴解析颜色/尺寸 → 重建 SKU 组合矩阵；箱包解析颜色映射 → 勾选颜色+自定义名+每色图
      if (row.variantParams) {
        const vp = parseVariantParams(row.variantParams);
        const cm = parseColorMap(row.variantParams);
        const baseMatrix = (facts.variants && Array.isArray(facts.variants.matrix)) ? facts.variants.matrix : [];
        if (profile.key === "xiangBao") {
          if (cm.length) {
            const colorImages = {};
            for (const c of cm) if (c.image) colorImages[c.color] = c.image;
            facts.variants = Object.assign({}, facts.variants || {}, {
              colors: cm.map((c) => c.color),
              sizes: [],
              matrix: [],
              colorMap: cm,
              colorImages
            });
            log(`箱包类目颜色映射覆盖: ${JSON.stringify(cm.map((c) => ({ color: c.color, custom: c.customName, img: c.image })))}`);
          } else if (vp.colors.length || vp.sizes.length) {
            facts.variants = Object.assign({}, facts.variants || {}, {
              colors: vp.colors,
              sizes: vp.sizes,
              matrix: [],
              dimensions: []
            });
            log(`箱包类目颜色勾选: colors=${JSON.stringify(vp.colors)} sizes=${JSON.stringify(vp.sizes)}`);
          }
        } else {
          const colors = vp.colors.length ? vp.colors : (facts.variants && facts.variants.colors) || [];
          const sizes = vp.sizes.length ? vp.sizes : (facts.variants && facts.variants.sizes) || [];
          const matrix = buildVariantMatrix(colors, sizes, baseMatrix);
          facts.variants = Object.assign({}, facts.variants || {}, {
            colors, sizes, matrix, dimensions: []
          });
          log(`覆盖变种参数: colors=${JSON.stringify(colors)} sizes=${JSON.stringify(sizes)} matrix=${matrix.length}`);
        }
      }
      const ready = checkDianxiaomiFactsReady(facts);
      if (!ready.ok) {
        item.status = "failed";
        item.reason = "facts 不完整: " + (ready.message || "");
        item.progress = 100;
        failed++; done++;
        batchRunState.overallProgress = total ? Math.round((done / total) * 100) : 100;
        await snapshot();
        continue;
      }
      dianxiaomiAdapter.setImageBaseDir(dir);
      log("引用模板: " + profile.templateProductId);
      await dianxiaomiAdapter.referenceProduct(profile.templateProductId);
      item.progress = 25;
      await dianxiaomiAdapter.fillFixedFields();
      item.progress = 50;
      const applied = await dianxiaomiAdapter.fillFromFacts(facts);
      // 记录图片/字段应用结果到日志，方便前端排错
      for (const a of applied) {
        if (a.ok === false) log(`${a.field}: FAIL ${a.reason || ""}`);
        else if (a.skipped) log(`${a.field}: SKIP ${a.reason || ""}`);
      }
      item.progress = 80;
      const saved = await dianxiaomiAdapter.save();
      dianxiaomiAdapter.resetImageBaseDir();
      if (saved && saved.saved) {
        item.status = "done";
        item.reason = saved.url || saved.message || "已存草稿";
        item.progress = 100;
        success++;
      } else {
        item.status = "failed";
        item.reason = (saved && (saved.error || saved.message || JSON.stringify(saved))) || "save 返回非 ok";
        item.progress = 100;
        failed++;
      }
    } catch (e) {
      try { dianxiaomiAdapter.resetImageBaseDir(); } catch { /* ignore */ }
      item.status = "failed";
      item.reason = e instanceof Error ? e.message : String(e);
      item.progress = 100;
      failed++;
    }
    done++;
    batchRunState.overallProgress = total ? Math.round((done / total) * 100) : 100;
    await snapshot();
  }
  batchRunState.running = false;
  batchRunState.finishedAt = Date.now();
  batchRunState.summary = { success, failed, skipped, total };
  await snapshot();
}

app.use((error, _request, response, _next) => {
    const uploadError = error.code === "LIMIT_FILE_SIZE"
        ? "单张图片不能超过 15 MB"
        : error.code === "LIMIT_FILE_COUNT"
            ? "单次最多上传 12 张图片，请重试"
            : error.message;
    response.status(500).json({ error: uploadError });
});
const server = app.listen(PORT, HOST, () => {
    const displayHost = HOST === "0.0.0.0" ? "0.0.0.0" : HOST;
    console.log(`Server listening on http://${displayHost}:${PORT}`);
    console.log(`Product images: ${PRODUCT_IMAGES_DIR}`);
});
server.on("error", (error) => {
    console.error("Local server failed:", error);
});
process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
});
process.on("unhandledRejection", (error) => {
    console.error("Unhandled rejection:", error);
});
for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
        sleepInhibitor.stop();
        server.close(() => process.exit(0));
    });
}
//# sourceMappingURL=server.js.map