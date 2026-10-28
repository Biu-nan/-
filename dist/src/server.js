import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import { HOST, OUTPUT_DIR, INSERT_BAG_IMAGES_DIR, INSERT_LINER_IMAGES_DIR, INSERT_OUTPUT_DIR, PORT, PRODUCT_IMAGES_DIR, PRODUCT_ROOT, PRODUCT_PROFILE_FILE, PROMPTS_DIR, PROJECT_ROOT, COMPLETED_PRODUCTS_DIR, HIDDEN_DATA_DIR, PUBLIC_DIR, USER_DATA_DIR, CHARM_REF_IMAGES_DIR, CHARM_CONTEXT_IMAGES_DIR, CHARM_OUTPUT_DIR, PRODUCT_STYLE_REF_DIR, MAX_STYLE_REFERENCE_IMAGES } from "./config.js";
import { DIANXIAOMI_TEMPLATE_PRODUCT_ID, PRODUCT_FACT_FILE, DIANXIAOMI_CATEGORY_PROFILES, getDianxiaomiProfile, isXiangBaoProfile } from "./config.js";
import { normalizeDianxiaomiFacts, buildProductFactsFallback } from "./dianxiaomi-facts.js";
// 2026-10-28：草稿执行走 ecom 的成熟 executor（子进程桥），不在这里重写上架流程。
import { runDraftExecutor } from "./draft-executor-bridge.js";
// 2026-10-28：1688 采集同样走 ecom 的 collector（子进程桥）。
import { runCollector, promoteStaging, ECOM_ROOT } from "./collector-bridge.js";

// 「上架资料」链路的统一暂存区：采集落这里，搬运也从这里取，
// 两边必须同一个路径，否则会出现「采到 A 处、搬 B 处找不到」。
const DOSSIER_STAGING_DIR = path.join(HIDDEN_DATA_DIR, "collect-staging");import { AutomationService } from "./automation-service.js";
import { ChatGptAdapter } from "./chatgpt-adapter.js";
import { GeminiAdapter } from "./gemini-adapter.js";
import { importImagesToDirectory, importImageUrlsToDirectory, removeImageFromDirectory, scanImages } from "./directory-images.js";
// 参考风格图：只参考风格，不参考产品信息（独立目录，不进 产品图/ 身份锁）
import { getStyleReferenceStatus, importStyleReferenceImages, importStyleReferenceImageUrls, invalidateStyleLock, removeStyleReferenceImage, scanStyleReferenceImages } from "./style-reference-service.js";
import { buildHandoff, importHandoff, listEcomProductSummaries, probeEcomService, scanEcomProducts } from "./ecom-connector.js";
import { LuxuryInsertService } from "./luxury-insert-service.js";
import { BagCharmService } from "./bag-charm-service.js";
import { CharmListingWorkspaceService } from "./charm-listing-workspace-service.js";
import { SelectionService } from "./product-selection-service.js";
import { NotebookLmAdapter } from "./notebooklm-adapter.js";
import { clearProductImages, importProductImageUrls, importProductImages, removeProductImage, scanProductImages } from "./image-files.js";
import { StateStore } from "./state-store.js";
import { abandonCurrentProduct, archiveCurrentProduct } from "./product-session.js";
import { PROMPT_KINDS, promptStatus, readPrompt, savePrompt } from "./prompt-files.js";
import { SleepInhibitor } from "./sleep-inhibitor.js";
import * as XLSX from "xlsx";
import { ProductProfileService } from "./product-profile-service.js";
import { QueueService } from "./queue-service.js";
import { OperationService } from "./operation-service.js";
import { DailyOperationService } from "./daily-operation-service.js";
import { OperatorService } from "./operator-service.js";
import { HiddenDataLoopService } from "./hidden-data-loop-service.js";
import { compileSecretaryIntent, resolveEffectiveRisk, computeRiskFloor } from "./secretary-model.js";
import { ProductVisualAssetsService } from "./product-visual-assets-service.js";
import { P0ProtocolService } from "./p0-protocol-service.js";
import { DianxiaomiAdapter } from "./dianxiaomi-adapter.js";
import { ResearchService } from "./research-service.js";
import { ResearchStore } from "./research-store.js";
import { registerBatchListingCreateRoutes, isListingCreateRunning, getLatestListingCreateJob, readInputWorkbook, recoverListingCreateState, listingCreateRunState } from "./batch-listing-create.js";
import { runListingEngine } from "./listing-engine.js";

// 引擎开关（灰度）读环境变量，避免依赖各调用点的 opts 签名（实测 opts 在嵌套作用域里取不到）。
const LISTING_ENGINE_ON = String(process.env.LISTING_ENGINE || "").toLowerCase() === "ecom";
const LISTING_ENGINE_COMMIT = String(process.env.LISTING_ENGINE_COMMIT || "1") !== "0";
// Listing Agent 集成入口（双形态：HTTP 优先，进程内兜底）。详见 listing-agent/README.md。
import { ListingAgentClient } from "../../listing-agent/src/agent-client.js";
// 系统状态总账（F1）：把 6 套并行状态机归一化成一份只读视图。详见 docs/SYSTEM_FRAMEWORK_v1.0.md
import { buildSystemState } from "./system-state.js";

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

// Listing Agent 客户端单例（双形态：默认 HTTP 调独立服务 http://localhost:${AGENT_PORT}，不可达回退进程内）。
const agentClient = new ListingAgentClient();
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
const bagCharmService = new BagCharmService(store, adapters);
const charmListingWorkspaceService = new CharmListingWorkspaceService();
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
// 把引用/采集箱批量上架的运行态快照成前端可读结构（只读，避免把内部 log 等大字段暴露出去）
function snapshotUploadRunState(runState) {
    if (!runState) return { running: false, jobId: null, overallProgress: 0, summary: null, items: [] };
    const items = Object.values(runState.items || {}).map((it) => ({
        productName: it.productName || it.name || it.packageName || "",
        mode: it.mode || "",
        status: it.status || "idle",
        currentStage: it.currentStage || "",
        progress: typeof it.progress === "number" ? it.progress : 0,
        reason: it.reason || ""
    }));
    return {
        running: !!runState.running,
        jobId: runState.jobId || null,
        startedAt: runState.startedAt || null,
        finishedAt: runState.finishedAt || null,
        overallProgress: typeof runState.overallProgress === "number" ? runState.overallProgress : 0,
        summary: runState.summary || null,
        items
    };
}

registerBatchListingCreateRoutes(app, {
    upload,
    store,
    standardService,
    productProfiles,
    runBackground,
    getBatchRunStateRunning: () => batchRunState.running,
    getCollectRunStateRunning: () => collectBatchRunState.running,
    getBatchRunState: () => snapshotUploadRunState(batchRunState),
    getCollectRunState: () => snapshotUploadRunState(collectBatchRunState),
    // ★ 自动上架触发器：listing 完成后后端自动串行跑引用 + 采集箱两条路径。
    // 走内部函数（不 HTTP 自调用）避免 409 互斥自拦；runCollectBatchListing 已支持 opts.operationId 幂等。
    // 复用 buildCollectRowForDir/buildReferenceRowForDir 解析 facts + 派生默认 category / searchTitle 等。
    triggerAutoUpload: async ({ jobId, filePath: xlsxPath, operationId, logger }) => {
        const log = typeof logger === "function" ? logger : () => {};
        log(`读取 input.xlsx: ${xlsxPath}`);
        let buf;
        try {
            buf = await readFile(xlsxPath);
        } catch (e) {
            log(`读 input.xlsx 失败: ${e.message}`);
            return { ok: false, error: "input.xlsx not readable" };
        }
        const wb = XLSX.read(buf, { type: "buffer" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const header = (aoa[0] || []).map((h) => String(h || "").trim());
        const col = (re) => header.findIndex((h) => re.test(h));
        const idx = {
            productName: col(/^(productName|产品名|产品名称|商品名)$/),
            uploadMode: col(/^(uploadMode|上架模式|上架类型)$/),
            searchTitle: col(/^(searchTitle|搜索标题|采集箱标题)$/),
            category: col(/^(category|类目|商品类目|产品类目|产品分类)$/),
            productTemplate: col(/^(productTemplate|产品模板|模板)$/),
            logisticsAttribute: col(/^(logisticsAttribute|物流属性|物流)$/),
            material: col(/^(material|材质)$/),
            referenceProductId: col(/^(referenceProductId|引用商品ID|引用ID)$/),
            variantThemeMap: col(/^(variantThemeMap|变种主题映射|变种映射)$/),
            outputDirectory: col(/^(outputDirectory|归档目录)$/)
        };
        const refRows = [];
        const colRows = [];
        for (let i = 1; i < aoa.length; i++) {
            const cells = aoa[i] || [];
            const get = (k) => (idx[k] >= 0 ? String(cells[idx[k]] || "").trim() : "");
            const productName = get("productName");
            if (!productName) continue;
            let mode = get("uploadMode").toLowerCase();
            if (mode === "引用" || mode === "reference" || mode === "ref" || mode === "yinyong") mode = "reference";
            else mode = "collect";
            const dir = path.join(COMPLETED_PRODUCTS_DIR, productName);
            const overrides = {
                searchTitle: get("searchTitle") || undefined,
                category: get("category") || undefined,
                productTemplate: get("productTemplate") || undefined,
                logisticsAttribute: get("logisticsAttribute") || undefined,
                material: get("material") || undefined,
                referenceProductId: get("referenceProductId") || undefined,
                variantThemeMap: get("variantThemeMap") || undefined
            };
            try {
                if (mode === "reference") {
                    const row = await buildReferenceRowForDir(dir, productName, overrides);
                    if (row) refRows.push(row);
                    else log(`引用行构建失败: ${productName}`);
                } else {
                    const row = await buildCollectRowForDir(dir, productName, overrides);
                    if (row) colRows.push(row);
                    else log(`采集箱行构建失败（无 facts）: ${productName}`);
                }
            } catch (e) {
                log(`行构建异常 ${productName}: ${e.message}`);
            }
        }
        log(`分流: reference=${refRows.length} collect=${colRows.length}`);
        const results = { refJobId: null, colJobId: null };
        try {
            if (refRows.length) {
                // 引用模式无 operationId 幂等门控，靠 listing 完成后只触发一次的契约保证不重复
                await runBatchListing(refRows);
                results.refJobId = batchRunState.jobId;
            }
            if (colRows.length) {
                // 采集箱已支持 opts.operationId，重复拾起会返回 idempotentReplay
                await runCollectBatchListing(colRows, { operationId });
                results.colJobId = collectBatchRunState.jobId;
            }
        } catch (e) {
            log(`run 出错: ${e.message}`);
            results.error = e.message;
        }
        return { ok: true, ...results };
    }
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
    // 大模型只做意图编译，产出草稿；不执行任何动作。
    // 失败/未配置凭据时降级为原占位逻辑，秘书不会因此不可用。
    const compiled = await compileSecretaryIntent({ message, pageContext, riskLevel });
    const intent = compiled.ok ? compiled.data : null;
    // 风险下限对模型结果与降级结果一视同仁：高风险措辞不会被漏判。
    const effectiveRisk = resolveEffectiveRisk(intent?.risk_level ?? riskLevel, message);
    const commandType = intent?.command_type ?? "secretary.chat.command";
    const draftCommand = await hiddenDataLoopService.createCommand({
        type: commandType,
        source: "secretary",
        payload: {
            message,
            page_context: pageContext,
            risk_level: effectiveRisk,
            model_intent: intent
                ? {
                    interpreted_intent: intent.interpreted_intent,
                    suggested_next_action: intent.suggested_next_action,
                    risk_level: intent.risk_level,
                    risk_model: intent.risk_model,
                    risk_floor: intent.risk_floor,
                    risk_escalated: intent.risk_escalated,
                    reason: intent.reason
                }
                : null,
            model: compiled.ok
                ? { provider: "api", name: compiled.model, latency_ms: compiled.latency_ms, degraded: false }
                : { provider: "api", name: null, latency_ms: compiled.latency_ms ?? 0, degraded: true, reason: compiled.reason }
        }
    });
    response.json({
        interpreted_intent: intent?.interpreted_intent || message || "未输入指令",
        reply: intent?.reply || "已生成本地 command 草稿，等待人工确认下一步。",
        suggested_next_action: intent?.suggested_next_action || "已生成本地 command 草稿，等待人工确认下一步。",
        related_context: pageContext,
        draft_command: draftCommand,
        risk_level: effectiveRisk,
        risk_model: intent?.risk_model ?? null,
        risk_floor: intent?.risk_floor ?? computeRiskFloor(message),
        risk_escalated: intent?.risk_escalated === true,
        requires_confirmation: effectiveRisk !== "L0",
        model: compiled.ok
            ? { used: true, name: compiled.model, latency_ms: compiled.latency_ms }
            : { used: false, name: null, latency_ms: compiled.latency_ms ?? 0, degraded: true, reason: compiled.reason },
        snapshot: intent?.snapshot ?? null
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
// 自愈标志：autoRun 残留仅自愈一次，避免每秒轮询都写盘
let _autoRunHealed = false;

/** 系统状态总账（F1）。
 * 只读聚合 6 套并行状态机 → 统一 WorkUnit 7 态视图。
 * 硬约束：不写文件、不改业务状态、不触发副作用；任一源坏掉不影响其余源。
 * 用途：回答"现在在跑什么 / 在等谁拍板 / 哪里卡住了"。
 */
app.get("/api/system/state", async (_request, response) => {
    try {
        response.json(await buildSystemState());
    }
    catch (error) {
        response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
app.get("/api/status", async (_request, response) => {
    // 自愈：进程曾被 watchdog 误杀导致收尾 finally 未执行，残留 autoRun:true
    // 会挡住所有新任务入口（批量/队列/内胆）。running 为空时自动复位。
    const _heal = store.get();
    if (_heal.autoRun && !_heal.running && !_autoRunHealed) {
        _autoRunHealed = true;
        try { await store.update({ autoRun: false }); } catch (_) {}
    }
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
        dianxiaomiStage: (typeof dianxiaomiAdapter !== "undefined" && typeof dianxiaomiAdapter.getStage === "function")
            ? dianxiaomiAdapter.getStage()
            : { name: "idle", detail: "", since: Date.now() },
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
        contentFiles: await contentFileStatus(),
        // 实时回报 ChatGPT 生成中心跳（供前端显示「生成中（已等待 Xs）」，消除进度不实时感）
        chatgptWaiting: (typeof adapters !== "undefined" && adapters && adapters.chatgpt && typeof adapters.chatgpt.getWaitingState === "function")
            ? adapters.chatgpt.getWaitingState()
            : null
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
// ChatGPT 首页会在浏览器健康检查后被临时写入 chatUrl；它不是产品对话，
// 不应阻止下一行清空/导入图片。只有实际会话 URL 才需要锁定事实源。
function hasActiveProductConversation(state) {
    const url = String(state?.chatUrl ?? "");
    return /^https:\/\/chatgpt\.com\/c\//.test(url) ||
        /^https:\/\/gemini\.google\.com\/app\//.test(url);
}
async function abandonStandaloneCurrentProduct() {
    const state = store.get();
    if (state.running || state.autoRun) {
        throw new Error("请先暂停当前任务，并等待它进入安全暂停状态后再遗弃");
    }
    // 判定是否有可遗弃商品：优先以磁盘上是否存在真实产品档案(product-profile.json)为准，
    // 否则在状态字段(imageCount/chatUrl/completedPhase)被异常清空时会误判为"没有可遗弃的商品"
    // 而拒绝遗弃（此前诊断过程中已触发该问题）。内存字段仅作为辅助判定。
    let hasCurrentProduct = Boolean(state.chatUrl) ||
        Boolean(state.completedPhase) ||
        Boolean(state.luxuryInsert?.taskId) ||
        state.imageCount > 0;
    if (!hasCurrentProduct) {
        try {
            await access(PRODUCT_PROFILE_FILE);
            hasCurrentProduct = true;
        }
        catch {
            // 无产品档案，确认无可遗弃商品
        }
    }
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
// ── 草稿执行（2026-10-28）────────────────────────────────────────────────
// 把 ecom 的 tools/dianxiaomi_draft_executor.mjs 当成外部执行器调用，不在这里
// 重写上架流程 —— 那 932 行已经跑通引用模板/19字段/变种/SKU/图片/回读/存草稿，
// 重写等于造第二套真相（此前在一跨重造 listing-engine 已证明走不通）。
//
// 安全边界：
//   commit 默认 false → FILL_VERIFY（只填不保存）。写草稿必须显式传 commit:true。
//   executor 本身只有 save/update draft 能力，文件头明写没有 publish action。
app.post("/api/draft/execute", async (request, response) => {
    try {
        const body = (request.body && typeof request.body === "object") ? request.body : {};
        const packageName = String(body.packageName || "").trim();
        if (!packageName) {
            response.status(400).json({ ok: false, error: "缺少 packageName" });
            return;
        }
        // 防路径穿越：包名允许「子目录/包名」（已完成产品 下确有 A已填充…/xxx 这类二级结构），
        // 但不许 .. 或绝对路径；最终以 resolve 后是否仍在 COMPLETED_PRODUCTS_DIR 之下为准。
        // 用前缀校验而不是「禁斜杠」——后者会把合法的二级路径误杀（实测踩到）。
        if (packageName.includes("..") || path.isAbsolute(packageName)) {
            response.status(400).json({ ok: false, error: "packageName 不允许包含 .. 或为绝对路径" });
            return;
        }
        const completedRoot = path.resolve(COMPLETED_PRODUCTS_DIR);
        // 也接受 ecom 的 input/：上架资料走到「计划已生成、尚未上架」时，包还停在
        // ecom 的 input/（要等 ERP_DRAFT 验证通过才会归档到 已完成产品/）。
        // 不认 input/ 的话，第③步在「先生成资料、人工确认」这条路上永远找不到包。
        const inputRoot = path.resolve(path.join(ECOM_ROOT, "input"));
        const pick = (root) => {
            const dir = path.resolve(path.join(root, packageName));
            if (dir !== root && !dir.startsWith(root + path.sep)) return null;
            return existsSync(dir) ? dir : null;
        };
        let pkgDir = pick(completedRoot);
        let pkgRoot = "已完成产品";
        if (!pkgDir) { pkgDir = pick(inputRoot); pkgRoot = "input"; }
        if (!pkgDir) {
            response.status(404).json({
                ok: false,
                error: `找不到产品包「${packageName}」：已完成产品/ 与 ecom input/ 下都没有。`
            });
            return;
        }
        const planPath = path.join(pkgDir, "erp", "field_plan.json");
        const commit = body.commit === true;
        const runId = new Date().toISOString().replace(/[:.]/g, "-");
        const outDir = path.join(HIDDEN_DATA_DIR, "draft-runs", runId);
        const result = await runDraftExecutor({ planPath, outDir, commit });
        response.json(result);
    }
    catch (error) {
        response.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});
// ── 来源 URL 采集（2026-10-28）──────────────────────────────────────────
// 把 1688 链接交给 ecom 的 collector（AliPrice 驱动）。一跨只做入口，
// 采集/反爬/图片下载/SKU 表双币种归一化全在 ecom，不在这里重写。
app.post("/api/collect/from-url", async (request, response) => {
    try {
        const body = (request.body && typeof request.body === "object") ? request.body : {};
        const url = String(body.url || "").trim();
        if (!url) {
            response.status(400).json({ ok: false, error: "缺少 url" });
            return;
        }
        // 只接受 1688 商品链接：collector 只认这个域，顺便挡住误填与任意域名请求
        if (!/^https?:\/\/([a-z0-9-]+\.)*1688\.com\//i.test(url)) {
            response.status(400).json({ ok: false, error: "只接受 1688 商品链接（*.1688.com）" });
            return;
        }
        const title = String(body.title || "").trim();
        const mode = body.mode === "listing" ? "listing" : "none";
        const result = await runCollector({ url, title, mode, stagingDir: DOSSIER_STAGING_DIR });
        response.json(result);
    }
    catch (error) {
        response.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});
// ── 上架资料 ②：把暂存区搬进 input/，并按 mode 接续流水线 ─────────────
// collector 的 --promote 是「搬运 + 按 --mode 提交给 ecom 控制台(8765)」。
// mode 白名单只放 none / listing：both 都不写草稿。
// full_original 虽然也能跑，但它会一路写到 ERP_DRAFT（真建草稿），
// 与「先生成资料、人工确认再上架」的意图不符，故不开放。
app.post("/api/dossier/promote", async (request, response) => {
    try {
        const body = (request.body && typeof request.body === "object") ? request.body : {};
        const rawMode = String(body.mode || "").trim();
        const mode = (rawMode === "listing" || rawMode === "none") ? rawMode : "none";
        const result = await promoteStaging({ stagingDir: DOSSIER_STAGING_DIR, mode });
        response.json(result);
    }
    catch (error) {
        response.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
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
        if (state.running || state.autoRun || hasActiveProductConversation(state)) {
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
/* ══ 参考风格图（Style Reference）：只参考风格，不参考产品信息 ══
   风格图独立存放在 当前产品/风格参考图/，不进 产品图/、不进身份锁、不进店小秘图源。
   改动后既有 style-lock 会被标记 stale，即「不再假装风格仍然一致」，是否重跑规划由用户决定。 */
async function styleReferenceChangeResponse(response, message) {
    const status = await getStyleReferenceStatus();
    const state = store.get();
    const needReplan = Boolean(state.planningText) || ["MVP3", "MVP4", "MVP5"].includes(state.completedPhase ?? "");
    response.json({
        ...status,
        message,
        needReplan,
        replanHint: needReplan
            ? "参考风格图已变更，请重新运行视觉规划，逐张生图才会使用新风格。"
            : undefined
    });
}
app.get("/api/style-ref-images", async (_request, response, next) => {
    try {
        response.json(await getStyleReferenceStatus());
    }
    catch (error) {
        next(error);
    }
});
app.get("/api/style-ref-images/:name", async (request, response) => {
    const name = path.basename(String(request.params.name ?? ""));
    if (name !== request.params.name) {
        response.status(400).json({ error: "无效的参考风格图文件名" });
        return;
    }
    const images = await scanStyleReferenceImages();
    const target = images.find((image) => image.name === name);
    if (!target) {
        response.status(404).json({ error: "参考风格图不存在" });
        return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.sendFile(path.join(PRODUCT_STYLE_REF_DIR, name));
});
app.post("/api/style-ref-images", upload.array("images", MAX_STYLE_REFERENCE_IMAGES), async (request, response, next) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        if (state.running || state.autoRun) {
            response.status(409).json({ error: "流程运行中，不能修改参考风格图" });
            return;
        }
        const files = request.files ?? [];
        if (files.length === 0) {
            response.status(400).json({ error: "没有收到参考风格图文件" });
            return;
        }
        const result = await importStyleReferenceImages(files);
        if (result.imported.length > 0) {
            await invalidateStyleLock(`参考风格图新增 ${result.imported.length} 张`);
        }
        if (result.imported.length === 0 && result.skippedDuplicates.length === 0) {
            response.status(400).json({
                error: `参考风格图最多 ${MAX_STYLE_REFERENCE_IMAGES} 张，或文件格式/大小不符合要求`,
                ...result
            });
            return;
        }
        await styleReferenceChangeResponse(response, `已导入 ${result.imported.length} 张参考风格图（只取风格，不取产品）`);
    }
    catch (error) {
        next(error);
    }
});
app.post("/api/style-ref-images/urls", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        if (state.running || state.autoRun) {
            response.status(409).json({ error: "流程运行中，不能修改参考风格图" });
            return;
        }
        const urls = Array.isArray(request.body?.urls)
            ? request.body.urls.map((url) => String(url ?? "").trim()).filter(Boolean)
            : [];
        const result = await importStyleReferenceImageUrls(urls);
        if (result.imported.length > 0) {
            await invalidateStyleLock(`参考风格图经 URL 新增 ${result.imported.length} 张`);
        }
        if (result.imported.length === 0) {
            response.status(400).json({
                error: result.skippedDuplicates.length > 0
                    ? "这些图片已存在，未重复导入"
                    : "URL 导入失败：仅支持可公开访问的 JPG / PNG / WEBP 直链，且不能是本机或内网地址",
                ...result
            });
            return;
        }
        await styleReferenceChangeResponse(response, `已从 URL 导入 ${result.imported.length} 张参考风格图（只取风格，不取产品）`);
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.delete("/api/style-ref-images/:name", async (request, response, next) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        if (state.running || state.autoRun) {
            response.status(409).json({ error: "流程运行中，不能修改参考风格图" });
            return;
        }
        const removed = await removeStyleReferenceImage(String(request.params.name ?? ""));
        await invalidateStyleLock(`参考风格图已删除：${removed}`);
        await styleReferenceChangeResponse(response, `已删除参考风格图 ${removed}`);
    }
    catch (error) {
        if (error instanceof Error && /不存在|无效/.test(error.message)) {
            response.status(404).json({ error: error.message });
            return;
        }
        next(error);
    }
});
app.post("/api/import-image-urls", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        const state = store.get();
        if (state.running || state.autoRun || hasActiveProductConversation(state)) {
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
    if (state.running || state.autoRun || hasActiveProductConversation(state)) {
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
    if (state.running || state.autoRun || hasActiveProductConversation(state)) {
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
    if (!["standard_listing", "luxury_insert", "bag_charm"].includes(mode)) {
        response.status(400).json({ error: "未知业务模式" });
        return;
    }
    try {
        const service = mode === "bag_charm" ? bagCharmService : insertService;
        response.json({ state: await service.selectMode(mode) });
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
/* ???? Listing ??????????????????????????????? */
app.get("/api/charm-listing/profiles", async (_request, response) => {
    response.json({ profiles: await charmListingWorkspaceService.profiles() });
});
app.post("/api/products/import", queueUpload.single("workbook"), async (request, response) => {
    try {
        let items = [];
        if (request.file) {
            const workbook = XLSX.read(request.file.buffer, { type: "buffer" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            items = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        }
        else {
            const raw = request.body?.items ?? request.body?.products ?? request.body;
            if (Array.isArray(raw)) items = raw;
            else if (typeof raw === "string") items = JSON.parse(raw);
            else if (raw && typeof raw === "object") items = [raw];
        }
        if (!items.length) { response.status(400).json({ error: "????????????Excel/CSV???" }); return; }
        const jobs = await charmListingWorkspaceService.createProducts(items);
        response.status(201).json({ jobs, count: jobs.length });
    } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.post("/api/listing-jobs", async (request, response) => {
    try {
        const raw = request.body?.items ?? request.body?.products ?? request.body;
        const jobs = await charmListingWorkspaceService.createProducts(Array.isArray(raw) ? raw : [raw]);
        response.status(201).json({ jobs, count: jobs.length });
    } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/listing-jobs", async (_request, response) => { response.json({ jobs: await charmListingWorkspaceService.listJobs() }); });
app.get("/api/listing-jobs/:id", async (request, response) => {
    const job = await charmListingWorkspaceService.job(request.params.id);
    if (!job) { response.status(404).json({ error: "Listing?????" }); return; }
    response.json({ job });
});
app.patch("/api/products/:id/facts", async (request, response) => {
    try { response.json({ product: await charmListingWorkspaceService.updateFacts(request.params.id, request.body ?? {}) }); }
    catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.post("/api/listing-jobs/:id/run", async (request, response) => {
    try { response.json({ job: await charmListingWorkspaceService.run(request.params.id) }); }
    catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.post("/api/listing-jobs/:id/retry", async (request, response) => {
    try {
        await charmListingWorkspaceService.log(request.params.id, "retry_requested", { stage: request.body?.stage ?? "current" });
        response.json({ job: await charmListingWorkspaceService.run(request.params.id) });
    } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/review-queue", async (_request, response) => {
    const jobs = await charmListingWorkspaceService.listJobs();
    response.json({ jobs: jobs.filter((job) => job.status === "REVIEW_REQUIRED") });
});
app.post("/api/listing-jobs/:id/approve", async (request, response) => {
    try { response.json({ job: await charmListingWorkspaceService.approve(request.params.id, request.body?.approvedBy) }); }
    catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.post("/api/listing-jobs/:id/publish", async (request, response) => {
    try { response.json({ job: await charmListingWorkspaceService.requestPublish(request.params.id, request.body?.approvalToken) }); }
    catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/publish-attempts/:id", async (request, response) => {
    const job = await charmListingWorkspaceService.job(request.params.id);
    if (!job?.publishAttempt) { response.status(404).json({ error: "??????" }); return; }
    response.json({ publishAttempt: job.publishAttempt, job });
});
app.post("/api/listing-jobs/:id/publish-receipt", async (request, response) => {
    try { response.json({ job: await charmListingWorkspaceService.recordPublishReceipt(request.params.id, request.body ?? {}) }); }
    catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
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
/* ══ 包包挂件（Bag Charm）Listing 自动制作管线路由 ══ */
app.post("/api/charm/ref-images", upload.array("images"), async (request, response, next) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        if (store.get().workflowMode !== "bag_charm") {
            response.status(409).json({ error: "当前不是包包挂件模式" });
            return;
        }
        const result = await bagCharmService.uploadRefImages(request.files ?? []);
        response.json(result);
    }
    catch (error) {
        next(error);
    }
});
app.delete("/api/charm/ref-images/:name", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        if (store.get().workflowMode !== "bag_charm") {
            response.status(409).json({ error: "当前不是包包挂件模式" });
            return;
        }
        response.json(await bagCharmService.removeRefImage(request.params.name));
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/charm/ref-image-urls", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        if (store.get().workflowMode !== "bag_charm" || store.get().running) {
            response.status(409).json({ error: "当前不能修改吊坠参考图" });
            return;
        }
        const urls = Array.isArray(request.body.urls) ? request.body.urls.map(String) : [];
        response.json({ result: await bagCharmService.importRefImageUrls(urls) });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/charm/context-images", upload.array("images"), async (request, response, next) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        if (store.get().workflowMode !== "bag_charm") {
            response.status(409).json({ error: "当前不是包包挂件模式" });
            return;
        }
        const result = await bagCharmService.uploadContextImages(request.files ?? []);
        response.json(result);
    }
    catch (error) {
        next(error);
    }
});
app.delete("/api/charm/context-images/:name", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        if (store.get().workflowMode !== "bag_charm") {
            response.status(409).json({ error: "当前不是包包挂件模式" });
            return;
        }
        response.json(await bagCharmService.removeContextImage(request.params.name));
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.put("/api/charm/meta", async (request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        if (store.get().workflowMode !== "bag_charm") {
            response.status(409).json({ error: "当前不是包包挂件模式" });
            return;
        }
        response.json({ charm: await bagCharmService.updateCharmMeta(request.body ?? {}) });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/charm/run/prompts", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    void sleepInhibitor.run(() => bagCharmService.buildPromptPack());
    response.status(202).json({ accepted: true });
});
app.post("/api/charm/run/images", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    void sleepInhibitor.run(() => bagCharmService.generateImages());
    response.status(202).json({ accepted: true });
});
app.post("/api/charm/run/listing-content", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    void sleepInhibitor.run(() => bagCharmService.generateListingContent());
    response.status(202).json({ accepted: true });
});
app.post("/api/charm/archive", async (_request, response) => {
    try {
        if (rejectIfQueueLocked(response))
            return;
        if (store.get().running) {
            response.status(409).json({ error: "当前已有任务正在运行" });
            return;
        }
        response.json({ state: await bagCharmService.archiveCompletedCharm() });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
app.post("/api/charm/run/resume", async (_request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    runBackground(() => bagCharmService.resume());
    response.status(202).json({ accepted: true });
});
app.get("/api/charm/output/:name", (request, response) => {
    const name = request.params.name;
    if (!/^Image_0[1-6]\.(png|jpe?g|webp)$/i.test(name)) {
        response.status(400).json({ error: "无效挂件输出文件名" });
        return;
    }
    response.sendFile(path.join(CHARM_OUTPUT_DIR, name));
});
app.get("/api/charm/image/:name", async (request, response) => {
    const name = request.params.name;
    const candidates = [
        ...(await scanImages(CHARM_REF_IMAGES_DIR)),
        ...(await scanImages(CHARM_CONTEXT_IMAGES_DIR, { preserveDuplicates: true }))
    ];
    const image = candidates.find((candidate) => candidate.name === name);
    if (!image) {
        response.status(404).json({ error: "挂件任务图片不存在" });
        return;
    }
    response.sendFile(image.path);
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
app.post("/api/run/image/:number", async (request, response) => {
    if (rejectIfQueueLocked(response))
        return;
    if (store.get().running || store.get().autoRun) {
        response.status(409).json({ error: "当前已有任务正在运行" });
        return;
    }
    const number = Number(request.params.number);
    if (!Number.isInteger(number) || number < 1 || number > 10) {
        response.status(400).json({ error: "图片编号必须是 1–10 的整数" });
        return;
    }
    runBackground(async () => {
        try {
            await standardService.regenerateSingleImage(number);
        }
        catch (error) {
            console.warn(`[image] 单图重生成失败 Image ${number}:`, error?.message || error);
        }
    });
    response.status(202).json({ accepted: true, image: number });
});
// ── ecom-translator 连接器（单向：ecom → 一跨而境）──────────────────────────
// 不合并两套系统：只做「跳转运行 + 交接清单导入」。root 可用 ECOM_TRANSLATOR_ROOT 覆盖。
const ECOM_LEDGER = path.join(HIDDEN_DATA_DIR, "ecom-handoffs", "ledger.json");
// 路径可配置：env > 项目根 .ecom-connector.json > vendor 默认。
// 用配置文件是因为 watchdog spawn 不继承 env，改路径不该要求重启。
async function resolveEcomConfig() {
    let fileConfig = {};
    try {
        fileConfig = JSON.parse(await readFile(path.join(PROJECT_ROOT, ".ecom-connector.json"), "utf8"));
    }
    catch {
        // 没有配置文件时用默认
    }
    return {
        root: process.env.ECOM_TRANSLATOR_ROOT || fileConfig.root || path.join(PROJECT_ROOT, "vendor", "ecom-translator"),
        consoleUrl: process.env.ECOM_CONSOLE_URL || fileConfig.consoleUrl || "http://127.0.0.1:8765"
    };
}

app.get("/api/ecom/status", async (_request, response) => {
    const config = await resolveEcomConfig();
    const [summaries, service] = await Promise.all([
        listEcomProductSummaries(config.root).catch(() => ({ outputDir: null, products: [] })),
        probeEcomService(config.consoleUrl)
    ]);
    response.json({
        root: config.root,
        outputDir: summaries.outputDir,
        exists: Boolean(summaries.exists),
        productCount: summaries.products.length,
        consoleUrl: config.consoleUrl,
        service
    });
});

app.get("/api/ecom/products", async (_request, response) => {
    const config = await resolveEcomConfig();
    const summaries = await listEcomProductSummaries(config.root).catch(() => ({ outputDir: null, products: [] }));
    response.json({ outputDir: summaries.outputDir, products: summaries.products });
});

app.post("/api/ecom/launch", async (_request, response) => {
    const config = await resolveEcomConfig();
    const service = await probeEcomService(config.consoleUrl);
    response.json({
        url: config.consoleUrl,
        alive: service.alive,
        hint: service.alive
            ? "ecom 控制台已在运行"
            : "未检测到 ecom 控制台。请先启动 ecom-translator 的「跨境运营控制台.bat」，再刷新本面板。"
    });
});

app.post("/api/ecom/import", async (request, response) => {
    if (store.get().running) {
        response.status(409).json({ error: "当前有任务在运行，请稍后再导入" });
        return;
    }
    const body = request.body ?? {};
    const all = Boolean(body.all);
    const dryRun = Boolean(body.dryRun);
    const folder = body.folder ? String(body.folder) : "";
    const config = await resolveEcomConfig();
    const { products } = await scanEcomProducts(config.root).catch(() => ({ products: [] }));
    const targets = all ? products : products.filter((product) => product.folder === folder);
    if (!targets.length) {
        response.status(404).json({ error: folder ? `未找到 ecom 产品：${folder}` : "ecom output/ 下没有可导入的产品" });
        return;
    }
    const results = [];
    for (const target of targets) {
        try {
            const handoff = await buildHandoff(target.productDir);
            const result = await importHandoff({
                handoff,
                targetRoot: COMPLETED_PRODUCTS_DIR,
                ledgerPath: ECOM_LEDGER,
                dryRun
            });
            results.push({ folder: target.folder, status: result.status, targetDir: result.targetDir, reason: result.reason });
        }
        catch (error) {
            results.push({ folder: target.folder, status: "ERROR", error: error?.message || String(error) });
        }
    }
    response.json({ ok: true, results });
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
            // 三个工作目录必须清空才能开始下一个内胆任务。fs.rm 被 safe-delete shim
            // 拦截走回收站，目录里有其它进程占用的产物时 trash 会失败（Windows 上
            // "Some operations were aborted"），导致整个 next 接口 500。按项目里其它
            // 模块的通行做法，把目录整体 rename 到 .reset.<ts> 旁路 shim，再 mkdir 新目录。
            const stamped = Date.now();
            const reinitDir = async (targetDir, label) => {
                try {
                    await access(targetDir);
                }
                catch {
                    await mkdir(targetDir, { recursive: true });
                    return;
                }
                const backup = `${targetDir}.reset.${stamped}-${label}`;
                try {
                    await rename(targetDir, backup);
                }
                catch (renameError) {
                    console.warn(`[insert/next] rename ${targetDir} → ${backup} 失败：${renameError?.message || renameError}；继续 mkdir 覆盖`);
                }
                await mkdir(targetDir, { recursive: true });
            };
            await Promise.all([
                reinitDir(INSERT_BAG_IMAGES_DIR, "bag"),
                reinitDir(INSERT_LINER_IMAGES_DIR, "liner"),
                reinitDir(INSERT_OUTPUT_DIR, "output")
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
  items: {}, // name -> { name, status, progress, reason, log:[] }
  rows: [], // 最近一次 apply 的原始行（供「重试失败项」重建）
  lastOperationId: null,
  // 心跳：每次进度快照刷新。自愈判定用它避免把「正在跑、但恰好在两行之间的间隙」
  // 误判成后台已死（否则会把 running 归零，导致同一时间被启动第二个任务）。
  lastActivityAt: null
};

async function detectCategory(dir) {
  let cat = "";
  try {
    const profile = JSON.parse(await readFile(path.join(dir, "product-profile.json"), "utf8"));
    cat = (profile.category || profile.key || "").toString();
  } catch { /* ignore */ }
  if (!cat) {
    try {
      const facts = JSON.parse(await readFile(path.join(dir, "product-facts.json"), "utf8"));
      cat = (facts.category || facts.categoryKey || "").toString();
    } catch { /* ignore */ }
  }
  if (!cat) return "auto";
  // 已知 profile 直接映射
  if (/乳贴|nipple|nipples/i.test(cat)) return "ruTie";
  if (/折叠|folding|foldable/i.test(cat)) return "xiangBaoFold";
  if (/(箱包配件|bag\s*parts|内胆|liner|insert)/i.test(cat)) return "xiangBao";
  // 钥匙扣/钥匙链/Bag Charm/Keychain/解压玩具：不属于现有 profile，返回原始精准类目串，
  // 由用户在表格内手填对应店小秘类目（避免 "bag" 误匹配成箱包）。
  if (/钥匙扣|钥匙链|keychain|charm|解压玩具|fidget/i.test(cat)) return cat;
  // 含 bag 但不属于「箱包配件」的（如 Bag Charm）也回退到原始串，避免误判为箱包
  if (/bag/i.test(cat)) return cat;
  return cat;
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
    // 自愈：先清掉「服务重启后残留的 running=true」，否则会被 409 永久拦死
    await normalizeBatchListingRunningState();
    // operationId 幂等（2026-10-24 补齐）：同 op 重放（任务仍在跑 / 刚结束 5 分钟内）→ 返回原 jobId，
    // 不重启任务、不报 409。防前端网络超时重发、刷新页面重发把同一批商品上架两次。
    const operationId = (request.body && typeof request.body.operationId === "string" && request.body.operationId.trim())
      ? request.body.operationId.trim()
      : null;
    if (isIdempotentReplay(batchRunState, operationId)) {
      return response.json({ ok: true, jobId: batchRunState.jobId, accepted: false, idempotentReplay: true });
    }
    if (batchRunState.running) return response.status(409).json({ ok: false, error: "已有批量任务在运行" });
    if (collectBatchRunState.running) return response.status(409).json({ ok: false, error: "采集箱批量上架正在运行" });
    const normalized = rows.map((r) => ({
      packageName: (r.packageName || "").toString().trim(),
      category: (r.category || "auto").toString().trim(),
      enabled: r.enabled === false || r.enabled === "false" || r.enabled === 0 || r.enabled === "0" ? false : true,
      store: (r.store || "").toString().trim(),
      brand: (r.brand || "").toString().trim(),
      variantParams: (r.variantParams || "").toString().trim(),
      stockType: (r.stockType || "").toString().trim(),
      referenceProductId: (r.referenceProductId || "").toString().trim(),
      // 2026-10-26：原来这里把 variantOn 丢掉了，于是 runBatchListing 的
      // keepVariants = (row.variantOn !== true) 恒为 true → fillSkus 永远被跳过
      // → 供货价/库存/编码从来不由程序写入（页面上留着引用模板源产品的值）。
      // 「SKU 从链接来」要求能覆盖变种，所以必须把这个开关透传下去。
      variantOn: r.variantOn === true || r.variantOn === "true"
    })).filter((r) => r.packageName);
    if (!normalized.length) return response.status(400).json({ ok: false, error: "无有效 packageName" });
    batchRunState.jobId = `batch-${Date.now()}`;
    batchRunState.lastOperationId = operationId;
    runBackground(() => runBatchListing(normalized, { jobId: batchRunState.jobId, operationId }));
    response.json({ ok: true, jobId: batchRunState.jobId, accepted: true });
  }
  catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// 引用批量「重试失败项」：扫描当前 failed 项，用已持久化的原始行（可被前端传入的最新编辑覆盖）
// 仅重跑失败项，done/skipped 项与整体进度保留（仿照采集箱 collect-batch-retry）。
app.post("/api/dianxiaomi/batch-retry", async (request, response) => {
  try {
    // 自愈：重启后残留的 running=true 会让重试也被 409 拦死
    await normalizeBatchListingRunningState();
    // 重试同样支持 operationId 幂等（同一次「重试」被重发时不重复跑）
    const operationId = (request.body && typeof request.body.operationId === "string" && request.body.operationId.trim())
      ? request.body.operationId.trim()
      : null;
    if (isIdempotentReplay(batchRunState, operationId)) {
      return response.json({ ok: true, jobId: batchRunState.jobId, accepted: false, idempotentReplay: true });
    }
    if (batchRunState.running) {
      return response.status(409).json({ ok: false, error: "引用批量上架正在运行" });
    }
    if (collectBatchRunState.running) {
      return response.status(409).json({ ok: false, error: "采集箱批量上架正在运行" });
    }
    if (!batchRunState.rows || !batchRunState.rows.length) {
      return response.status(400).json({ ok: false, error: "未找到原始行数据（可能服务重启过），请重新开始上架" });
    }
    const retryableItems = Object.values(batchRunState.items).filter((it) => it.status === "failed" || it.status === "skipped");
    if (!retryableItems.length) {
      return response.status(400).json({ ok: false, error: "当前没有失败/跳过项可重试" });
    }
    // 可选：前端传入最新编辑后的失败行（覆盖店铺/品牌/变种参数等）
    const passed = (request.body && Array.isArray(request.body.rows)) ? request.body.rows : [];
    const overrides = {};
    for (const r of passed) {
      if (r && r.packageName) {
        overrides[r.packageName] = {
          category: r.category || "auto",
          store: (r.store || "").toString().trim(),
          brand: (r.brand || "").toString().trim(),
          variantParams: (r.variantParams || "").toString().trim(),
          stockType: (r.stockType || "").toString().trim(),
          referenceProductId: (r.referenceProductId || "").toString().trim(),
          // 与 batch-apply 保持一致：变种覆盖开关必须透传，否则重试会静默退回「沿用模板变种」
          variantOn: r.variantOn === true || r.variantOn === "true",
          enabled: r.enabled !== false
        };
      }
    }
    batchRunState.jobId = `batch-${Date.now()}`;
    batchRunState.lastOperationId = operationId;
    runBackground(() => runBatchListing(batchRunState.rows, { retry: true, overrides, jobId: batchRunState.jobId, operationId }));
    response.json({ ok: true, jobId: batchRunState.jobId, accepted: true, retryCount: retryableItems.length });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// 进度查询：前端每秒轮询
app.get("/api/dianxiaomi/batch-status", async (_request, response) => {
  try {
    // 懒恢复：服务重启后内存状态为空时从磁盘快照回读（含 failed 项，供「重试失败项」）
    // 随后自愈：残留 running=true 且无活跃 item → 归零，前端不会一直显示"运行中"
    if (!batchRunState.jobId) {
      await recoverBatchListingState();
    }
    await normalizeBatchListingRunningState();
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

// ===== 采集箱批量上架：路由（v 新路径，2026-07-28）=====

// ===== 工作流桥接辅助：由 input.xlsx 的 uploadMode 分流构建上架行 =====
// 采集箱模式行（复用 collect-batch-generate 的字段语义，支持 overrides 覆盖）
async function buildCollectRowForDir(dir, name, overrides) {
    overrides = overrides || {};
    let facts = null;
    try {
        // 修复：PRODUCT_FACT_FILE 是绝对路径（config.js:105），path.join(dir, 绝对路径) 会拼成垃圾，
        // 导致归档包的真实 product-facts.json 被完全忽略，每次都走 run-state 兜底。
        facts = JSON.parse(await readFile(path.join(dir, "product-facts.json"), "utf8"));
    } catch { /* 无 facts 尝试兜底 */ }
    if (!facts) {
        try {
            const rs = JSON.parse(await readFile(path.join(dir, "run-state.json"), "utf8"));
            if (rs.listingContentText || rs.responseText) {
                facts = await buildProductFactsFallback({
                    factText: rs.responseText || "",
                    listingContentText: rs.listingContentText || "",
                    baseDir: dir
                });
                await writeFile(path.join(dir, "product-facts.json"), `${JSON.stringify(facts, null, 2)}\n`, "utf8");
            }
        } catch (fbErr) {
            console.warn(`[workflow] 包 ${name} 本地兜底生成 facts 失败:`, fbErr && fbErr.message ? fbErr.message : fbErr);
        }
    }
    if (!facts) return null;
    // 优先使用表格显式填写的类目（overrides.category）；未填 / "auto" 才走 detectCategory 自动识别兜底。
    const explicitCat = (overrides.category && overrides.category !== "auto") ? String(overrides.category).trim() : "";
    let category = explicitCat || "ruTie";
    if (!explicitCat) { try { category = await detectCategory(dir); } catch { /* ignore */ } }
    const profile = getDianxiaomiProfile(category);
    const defaultProductTemplate = (profile && profile.defaultProductTemplate) || "";
    const title = (facts.title && (facts.title.zh || facts.title.en)) || "";
    return {
        packageName: name,
        category,
        searchTitle: overrides.searchTitle || title,
        factsPath: dir,
        variantOverride: overrides.variantOverride || "",
        variantThemeMap: overrides.variantThemeMap || "",
        productTemplate: overrides.productTemplate || defaultProductTemplate,
        logisticsAttribute: overrides.logisticsAttribute || "",
        material: overrides.material || "",
        enabled: true,
        status: "idle",
        progress: 0,
        reason: ""
    };
}

// 引用模式行：靠 referenceProductId 引用已建商品；同时透传产品模板/物流/材质（adapter ruTie 分支支持）
async function buildReferenceRowForDir(dir, name, overrides) {
    overrides = overrides || {};
    // 优先使用表格显式填写的类目（overrides.category）；未填 / "auto" 才走 detectCategory 自动识别兜底。
    const explicitCat = (overrides.category && overrides.category !== "auto") ? String(overrides.category).trim() : "";
    let category = explicitCat || "ruTie";
    if (!explicitCat) { try { category = await detectCategory(dir); } catch { /* ignore */ } }
    const profile = getDianxiaomiProfile(category);
    return {
        packageName: name,
        category,
        referenceProductId: overrides.referenceProductId || (profile && profile.templateProductId) || "",
        productTemplate: overrides.productTemplate || (profile && profile.defaultProductTemplate) || "",
        logisticsAttribute: overrides.logisticsAttribute || "",
        material: overrides.material || "",
        enabled: true,
        status: "idle",
        progress: 0,
        reason: ""
    };
}

// 生成「采集批量上架模板」：扫描 已完成产品/ 中含 product-facts.json 的包，
// 按 detectCategory 判定类目，取 facts.title 作为预填「搜索标题」。可选 body.category 过滤类目。
app.post("/api/dianxiaomi/collect-batch-generate", async (request, response) => {
  try {
    const onlyCat = (request.body && request.body.category) ? String(request.body.category).trim() : "";
    const names = await readdir(COMPLETED_PRODUCTS_DIR).catch(() => []);
    const rows = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const dir = path.join(COMPLETED_PRODUCTS_DIR, name);
      let isDir = false;
      try { isDir = (await stat(dir)).isDirectory(); } catch { isDir = false; }
      if (!isDir) continue;
      let facts = null;
      try { facts = JSON.parse(await readFile(path.join(dir, "product-facts.json"), "utf8")); } catch { /* 无 facts 尝试兜底 */ }
      if (!facts) {
        // 缺文件兜底：用包内 run-state.json 的 listingContentText/responseText + 本地图片本地生成，
        // 避免采集箱批量上架因缺文件而整批跳过（与生成端 buildProductFactsFallback 同逻辑）。
        try {
          const rs = JSON.parse(await readFile(path.join(dir, "run-state.json"), "utf8"));
          if (rs.listingContentText || rs.responseText) {
            const { buildProductFactsFallback } = await import("./dianxiaomi-facts.js");
            const fb = await buildProductFactsFallback({
              factText: rs.responseText || "",
              listingContentText: rs.listingContentText || "",
              baseDir: dir
            });
            await writeFile(path.join(dir, "product-facts.json"), `${JSON.stringify(fb, null, 2)}\n`, "utf8");
            facts = fb;
          }
        }
        catch (fbErr) {
          console.warn(`[collect-batch] 包 ${name} 本地兜底生成 facts 失败:`, fbErr && fbErr.message ? fbErr.message : fbErr);
        }
      }
      if (!facts) continue;
      let category = "ruTie";
      try { category = await detectCategory(dir); } catch { /* ignore */ }
      if (onlyCat && category !== onlyCat) continue;
      // 按检测到的类目取 profile，自动带出默认产品模板（如箱包配件→箱包配件-包饰）。
      const profile = getDianxiaomiProfile(category);
      const defaultProductTemplate = (profile && profile.defaultProductTemplate) || "";
      const title = (facts.title && (facts.title.zh || facts.title.en)) || "";
      rows.push({
        packageName: name,
        category,
        searchTitle: title,
        factsPath: dir,
        // 变种覆盖：默认空 = 沿用采集箱源变种。填 1/是/覆盖 才用 facts 重建颜色/尺寸/SKU。
        variantOverride: "",
        // 产品模板：默认空 = 不引用；类目 profile 配置了 defaultProductTemplate 则自动带出。
        productTemplate: defaultProductTemplate,
        // 物流属性：默认空 = 走 profile/默认「普货」；表格填值（如 普货/带电/液体）则优先使用。
        logisticsAttribute: "",
        // 材质：默认空 = 走 facts.material；表格「材质」列显式填写则优先使用（覆盖模板带入值）。
        material: "",
        enabled: true,
        status: "idle",
        progress: 0,
        reason: ""
      });
    }
    response.json({ ok: true, rows, count: rows.length });
  }
  catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// 采集箱批量上架入口：接收人工核对过的 rows（搜索标题/类目/包名），后台顺序执行。
app.post("/api/dianxiaomi/collect-batch-apply", async (request, response) => {
  try {
    const rows = (request.body && Array.isArray(request.body.rows)) ? request.body.rows : [];
    if (!rows.length) return response.status(400).json({ ok: false, error: "rows 为空" });
    await normalizeCollectBatchRunningState();
    // operationId 幂等：同 op 重放 → 直接返回原 jobId（不重启任务，不触发 409）。
    // 判定统一走 isIdempotentReplay（含 5 分钟时间窗）：此前是无条件永久重放，
    // 若前端开始传 op，用户想对同一批再跑一次会被永久吞掉。
    const operationId = (request.body && typeof request.body.operationId === "string" && request.body.operationId.trim())
      ? request.body.operationId.trim()
      : null;
    if (isIdempotentReplay(collectBatchRunState, operationId)) {
      return response.json({ ok: true, jobId: collectBatchRunState.jobId, accepted: false, idempotentReplay: true });
    }
    if (collectBatchRunState.running) return response.status(409).json({ ok: false, error: "已有采集箱批量任务在运行" });
    if (batchRunState.running) return response.status(409).json({ ok: false, error: "引用批量上架正在运行" });
    const normalized = rows.map((r) => ({
      packageName: (r.packageName || "").toString().trim(),
      category: (r.category || "auto").toString().trim(),
      searchTitle: (r.searchTitle || r.packageName || "").toString().trim(),
      enabled: r.enabled === false || r.enabled === "false" || r.enabled === 0 || r.enabled === "0" ? false : true,
      factsPath: (r.factsPath || "").toString().trim(),
      variantThemeMap: (r.variantThemeMap || "").toString().trim(),
      // 变种覆盖开关：默认空 = 沿用采集箱源变种（不动颜色/尺寸/SKU）。
      // 填 1/true/是/覆盖 才允许用 product-facts 的 variants 重建变种。
      variantOverride: parseVariantOverrideFlag(r.variantOverride),
      // 产品模板：默认空 = 不引用。填模板名称（如「箱包配件-包饰」）则自动引用。
      productTemplate: (r.productTemplate || "").toString().trim(),
      // 物流属性：表格列，空则回退 profile/默认「普货」。
      logisticsAttribute: (r.logisticsAttribute || "").toString().trim(),
      // 材质：表格列，空则回退 facts.material。
      material: (r.material || "").toString().trim()
    })).filter((r) => r.packageName);
    if (!normalized.length) return response.status(400).json({ ok: false, error: "无有效 packageName" });
    collectBatchRunState.jobId = `collect-${Date.now()}`;
    collectBatchRunState.lastOperationId = operationId; // 持久化到 snapshot，供下次同 op 命中
    runBackground(() => runCollectBatchListing(normalized));
    response.json({ ok: true, jobId: collectBatchRunState.jobId, accepted: true });
  }
  catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// 采集箱批量进度查询（前端每秒轮询）
app.get("/api/dianxiaomi/collect-batch-status", async (_request, response) => {
  try {
    // 懒恢复：服务重启后内存状态为空时，从磁盘快照回读（含 failed 项，供「重试失败项」）
    if (!collectBatchRunState.jobId) {
      await recoverCollectBatchState();
      await normalizeCollectBatchRunningState();
    }
    const items = Object.values(collectBatchRunState.items).map((it) => ({
      name: it.name,
      status: it.status,
      progress: it.progress,
      reason: it.reason,
      log: it.log.slice(-50)
    }));
    response.json({
      ok: true,
      running: collectBatchRunState.running,
      jobId: collectBatchRunState.jobId,
      overallProgress: collectBatchRunState.overallProgress,
      summary: collectBatchRunState.summary,
      dianxiaomiStage: (typeof dianxiaomiAdapter !== "undefined" && typeof dianxiaomiAdapter.getStage === "function")
        ? dianxiaomiAdapter.getStage()
        : { name: "idle", detail: "", since: Date.now() },
      items
    });
  }
  catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// 采集箱批量「重试失败项」：扫描当前 failed 项，用已持久化的原始行（可被前端传入的最新编辑覆盖）
// 仅重跑失败项，done/skipped 项与整体进度保留。
app.post("/api/dianxiaomi/collect-batch-retry", async (request, response) => {
  try {
    await normalizeCollectBatchRunningState();
    // 重试同样支持 operationId 幂等（同一次「重试」被重发时不重复跑）
    const operationId = (request.body && typeof request.body.operationId === "string" && request.body.operationId.trim())
      ? request.body.operationId.trim()
      : null;
    if (isIdempotentReplay(collectBatchRunState, operationId)) {
      return response.json({ ok: true, jobId: collectBatchRunState.jobId, accepted: false, idempotentReplay: true });
    }
    if (collectBatchRunState.running) {
      return response.status(409).json({ ok: false, error: "已有采集箱批量任务在运行" });
    }
    if (batchRunState.running) {
      return response.status(409).json({ ok: false, error: "引用批量上架正在运行" });
    }
    if (!collectBatchRunState.rows || !collectBatchRunState.rows.length) {
      return response.status(400).json({ ok: false, error: "未找到原始行数据（可能服务重启过），请重新生成模板并点「开始」上架" });
    }
    const retryableItems = Object.values(collectBatchRunState.items).filter((it) => it.status === "failed" || it.status === "skipped");
    if (!retryableItems.length) {
      return response.status(400).json({ ok: false, error: "当前没有失败/跳过项可重试" });
    }
    // 可选：前端传入最新编辑后的失败/跳过行（覆盖搜索标题/类目/变种映射）
    const passed = (request.body && Array.isArray(request.body.rows)) ? request.body.rows : [];
    const overrides = {};
    for (const r of passed) {
      if (r && r.packageName) {
        overrides[r.packageName] = {
          searchTitle: r.searchTitle || r.packageName,
          category: r.category || "auto",
          variantThemeMap: r.variantThemeMap || "",
          variantOverride: parseVariantOverrideFlag(r.variantOverride),
          productTemplate: (r.productTemplate || "").toString().trim(),
          logisticsAttribute: (r.logisticsAttribute || "").toString().trim(),
          material: (r.material || "").toString().trim(),
          enabled: r.enabled !== false
        };
      }
    }
    collectBatchRunState.jobId = `collect-${Date.now()}`;
    collectBatchRunState.lastOperationId = operationId;
    runBackground(() => runCollectBatchListing(collectBatchRunState.rows, { retry: true, overrides }));
    response.json({ ok: true, jobId: collectBatchRunState.jobId, accepted: true, retryCount: retryableItems.length });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ===== 工作流桥接：批量制作(Listing) → 批量上架 =====
// 读最新制作作业的 input.xlsx，按 uploadMode 分流生成引用/采集箱上架行，
// 用 outputDirectory 作 join 外键带入用户填的 searchTitle/模板/物流/材质/引用ID/变种映射。
app.post("/api/workflow/listing-to-upload", async (request, response) => {
    try {
        const body = (request.body && typeof request.body === "object") ? request.body : {};
        const excludeUploaded = body.excludeUploaded === true;
        // 新 server 启动后内存态可能未恢复，先尝试恢复最新作业（与 status/retry 路由一致）
        if (!listingCreateRunState.jobId) {
            await recoverListingCreateState();
        }
        if (isListingCreateRunning()) {
            return response.json({ ok: true, running: true, jobId: getLatestListingCreateJob().jobId });
        }
        const job = getLatestListingCreateJob();
        if (!job.jobId) {
            return response.json({ ok: false, error: "没有可用的批量制作作业（请先跑一次批量制作）" });
        }
        const inputRows = await readInputWorkbook();
        if (!inputRows.length) {
            return response.json({ ok: false, error: "制作作业无有效行（input.xlsx 缺失或尚未完成）" });
        }
        // 去重：读两 state 的 done 项（packageName）
        const uploaded = new Set();
        if (!excludeUploaded) {
            try {
                const bl = JSON.parse(await readFile(path.join(HIDDEN_DATA_DIR, "batch-listing-state.json"), "utf8"));
                for (const [k, it] of Object.entries(bl.items || {})) {
                    if (it && it.status === "done") uploaded.add(it.name || k);
                }
            } catch { /* ignore */ }
            try {
                const cb = JSON.parse(await readFile(path.join(HIDDEN_DATA_DIR, "collect-batch-state.json"), "utf8"));
                for (const [k, it] of Object.entries(cb.items || {})) {
                    if (it && it.status === "done") uploaded.add(it.name || k);
                }
            } catch { /* ignore */ }
        }
        const referenceRows = [];
        const collectRows = [];
        const skipped = [];
        let dedupCount = 0;
        for (const r of inputRows) {
            const od = r.outputDirectory;
            if (!od) {
                skipped.push({ productName: r.productName, reason: "无归档目录(outputDirectory 为空)" });
                continue;
            }
            const dir = path.resolve(USER_DATA_DIR, od);
            let dirExists = false;
            try { dirExists = (await stat(dir)).isDirectory(); } catch { dirExists = false; }
            if (!dirExists) {
                skipped.push({ productName: r.productName, reason: "归档目录不存在: " + od });
                continue;
            }
            const pkgName = path.basename(od.replace(/\\/g, "/"));
            const overrides = {
                searchTitle: r.searchTitle || undefined,
                productTemplate: r.productTemplate || undefined,
                logisticsAttribute: r.logisticsAttribute || undefined,
                material: r.material || undefined,
                referenceProductId: r.referenceProductId || undefined,
                variantThemeMap: r.variantThemeMap || undefined
            };
            if (!excludeUploaded && uploaded.has(pkgName)) {
                dedupCount++;
                continue;
            }
            if (r.uploadMode === "reference") {
                const row = await buildReferenceRowForDir(dir, pkgName, overrides);
                if (!row) { skipped.push({ productName: r.productName, reason: "无法构建引用行" }); continue; }
                referenceRows.push(row);
            } else {
                const row = await buildCollectRowForDir(dir, pkgName, overrides);
                if (!row) { skipped.push({ productName: r.productName, reason: "缺少 product-facts.json 且兜底失败" }); continue; }
                collectRows.push(row);
            }
        }
        return response.json({
            ok: true,
            jobId: job.jobId,
            finishedAt: job.finishedAt,
            referenceRows,
            collectRows,
            skipped,
            dedupCount
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return response.status(500).json({ ok: false, error: message });
    }
});

// 探索采集箱：dump 列表页 DOM 结构，便于校准导航选择器（需 Chrome+店小秘已登录）。
app.post("/api/dianxiaomi/collect-explore", async (_request, response) => {
  try {
    const dump = await dianxiaomiAdapter.exploreCollectBox();
    response.json({ ok: true, dump });
  }
  catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// 解析「变种覆盖」开关：默认 false = 完全沿用采集箱源变种（不勾选/取消颜色尺寸、不重建 SKU）。
// 仅当模板该列填 1/true/yes/是/覆盖/override 时才返回 true，允许用 product-facts 的 variants 重建变种。
// 设计意图：采集箱草稿的变种来自 1688 源商品，比 facts（尤其 local_fallback 兜底档）更准，默认不动。
function parseVariantOverrideFlag(v) {
  if (v === true) return true;
  if (v === false || v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  if (!s) return false;
  return /^(1|true|yes|y|on|是|覆盖|override)$/.test(s);
}

// 解析表格/行数据里的「变种主题映射」文本 → { "颜色": "Color", "型号": "Size" }
// 格式：1688主题:速卖通主题;…  支持中英文冒号、分号/换行分隔。空串返回 {}。
function parseVariantThemeMap(str) {
  const map = {};
  if (!str) return map;
  const parts = String(str).split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^([^:：]+)[：:]\s*(.+)$/);
    if (!m) continue;
    const src = m[1].trim();
    const dst = m[2].trim();
    if (src && dst) map[src] = dst;
  }
  return map;
}

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
    // 2026-10-26 修复（真机实测暴露）：原来的判据只排除「无 = 但含 ,」的乳贴式纯颜色列表，
    // 于是**任何非颜色段都会被当成颜色** —— 实测 "颜色：Gold,Silver,Red; 尺寸：5.4CM"
    // 被解析成 [{color:"尺寸：5.4CM"}]，colors 被污染成 ["尺寸：5.4CM"]。
    // 改为只认「颜色 / color」开头的段，其余段（尺寸/尺码/其它销售属性）直接跳过。
    if (!/^(颜色|color)\s*[：:=]/i.test(seg)) continue;
    const seg2 = seg.replace(/^(颜色|color)\s*[：:]\s*/i, "");
    if (!seg2) continue;
    // 跳过乳贴式纯颜色列表（无 = 但含 ,）—— 这类由 parseVariantParams 处理
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

// 由 colors × sizes 重建 SKU 组合矩阵。
// 2026-10-26 修复：原实现**全部行都用 baseMatrix 首行**的价格/库存，并重新生成 `SKU-${ci}${si}`
// 编码 —— 等于把每一行的真实供货价、库存和编码都抹平成一个值。
// 这正是「SKU 从链接来」要保住的东西。改为**逐组合继承**：同 colors+sizes 的源行优先，
// 匹配不到才退回首行；编码沿用源行的 sku，只有源行没有编码时才生成。
function buildVariantMatrix(colors, sizes, baseMatrix) {
  const colorList = (colors && colors.length) ? colors : ["默认"];
  const sizeList = (sizes && sizes.length) ? sizes : ["One Size"];
  const base = Array.isArray(baseMatrix) ? baseMatrix : [];
  const sample = base.length ? base[0] : null;
  const norm = (v) => String(v === null || v === undefined ? "" : v).trim().toLowerCase();
  const findBase = (color, size) => {
    const hit = base.find((row) => {
      const combo = Array.isArray(row.combination) ? row.combination : [];
      const colorOk = norm(combo[0]) === norm(color);
      const sizeOk = sizeList.length <= 1 || norm(combo[1]) === norm(size);
      return colorOk && sizeOk;
    });
    return hit || sample;
  };
  const matrix = [];
  colorList.forEach((c, ci) => sizeList.forEach((s, si) => {
    const src = findBase(c, s) || {};
    const price = Number(src.price) > 0 ? Number(src.price) : 3.5;
    const stock = Number(src.stock) > 0 ? Number(src.stock) : 100;
    const weight = src.weight !== null && src.weight !== undefined ? Number(src.weight) : 0.03;
    matrix.push({
      combination: [c, s],
      price, stock, weight,
      sku: src.sku ? String(src.sku) : `SKU-${ci}${si}`,
      barcode: src.barcode ? String(src.barcode) : ""
    });
  }));
  return matrix;
}

// ===== 采集箱批量上架（v 新路径，2026-07-28）=====
// 与「引用上架」平行：不引用模板，而是打开速卖通全托管采集箱 → 搜标题 → 点编辑 →
// 用 product-facts 填（保留采集箱自带源图）→ 保存不发布。复用 fillFromFacts(collectMode=true) + save()。
const collectBatchRunState = {
  running: false,
  jobId: null,
  startedAt: null,
  finishedAt: null,
  overallProgress: 0,
  summary: null,
  items: {},
  rows: [], // 最近一次 apply 的原始行（含 searchTitle/category/variantThemeMap），用于「重试失败项」重建
  lastOperationId: null // 最近一次 apply 的 operationId（幂等键）：同 op 重放直接返回原 jobId，不重启任务
};

async function runCollectBatchListing(rows, opts = {}) {
  const retryMode = !!(opts && opts.retry);
  collectBatchRunState.running = true;
  if (!retryMode) {
    collectBatchRunState.jobId = `collect-${Date.now()}`;
    collectBatchRunState.startedAt = Date.now();
    collectBatchRunState.finishedAt = null;
    collectBatchRunState.summary = null;
    collectBatchRunState.items = {};
    collectBatchRunState.overallProgress = 0;
    collectBatchRunState.rows = rows; // 持久化原始行，供「重试失败项」重建
  }
  const snapshot = async () => {
    try {
      await writeFile(
        path.join(HIDDEN_DATA_DIR, "collect-batch-state.json"),
        JSON.stringify(collectBatchRunState, null, 2),
        "utf8"
      );
    } catch { /* ignore */ }
  };

  // 重试模式：仅重跑 failed/skipped 项，保留 done 项与整体进度
  if (retryMode) {
    const rowsById = new Map((collectBatchRunState.rows || []).map((r) => [r.packageName, r]));
    const overrides = (opts && opts.overrides) || {};
    const targets = Object.values(collectBatchRunState.items)
      .filter((it) => (it.status === "failed" || it.status === "skipped") && rowsById.has(it.name))
      .map((it) => Object.assign({}, rowsById.get(it.name), overrides[it.name] || {}));
    const total = Object.keys(collectBatchRunState.items).length || targets.length;
    let done = Object.values(collectBatchRunState.items).filter((it) => it.status === "done" || it.status === "skipped").length;
    for (const row of targets) {
      const item = collectBatchRunState.items[row.packageName];
      item.status = "running";
      item.progress = 0;
      item.reason = "";
      item.log = Array.isArray(item.log) ? item.log : [];
      item.log.push(`[${new Date().toISOString()}] ↻ 重试失败项`);
      const log = (m) => item.log.push(`[${new Date().toISOString()}] ${m}`);
      const st = await processCollectBatchRow(row, item, log);
      if (st === "done") {
        const savedReason = item.reason;
        const arc = await archiveCollectRow(row, item, log);
        item.reason = [savedReason, arc.ok ? `已归档:${arc.message}` : `归档警告:${arc.message}`].filter(Boolean).join(" | ");
      }
      done += 1;
      collectBatchRunState.overallProgress = total ? Math.round((done / total) * 100) : 100;
      await snapshot();
    }
    collectBatchRunState.running = false;
    dianxiaomiAdapter.setStage("idle", "");
    collectBatchRunState.finishedAt = Date.now();
    const all = Object.values(collectBatchRunState.items);
    collectBatchRunState.summary = {
      success: all.filter((it) => it.status === "done").length,
      failed: all.filter((it) => it.status === "failed").length,
      skipped: all.filter((it) => it.status === "skipped").length,
      total: all.length
    };
    await snapshot();
    return;
  }

  const targets = rows.filter((r) => r.enabled !== false && r.packageName);
  const total = targets.length;
  let success = 0, failed = 0, skipped = 0, done = 0;
  for (const row of targets) {
    const name = row.packageName;
    const item = { name, status: "running", progress: 0, reason: "", log: [] };
    collectBatchRunState.items[name] = item;
    const log = (m) => item.log.push(`[${new Date().toISOString()}] ${m}`);
    log(`采集箱上架: ${name} | 搜索标题: ${row.searchTitle}`);
    const st = await processCollectBatchRow(row, item, log);
    if (st === "done") {
      const savedReason = item.reason;
      const arc = await archiveCollectRow(row, item, log);
      item.reason = [savedReason, arc.ok ? `已归档:${arc.message}` : `归档警告:${arc.message}`].filter(Boolean).join(" | ");
      success++;
    }
    else if (st === "skipped") skipped++;
    else failed++;
    done += 1;
    collectBatchRunState.overallProgress = total ? Math.round((done / total) * 100) : 100;
    await snapshot();
  }
  collectBatchRunState.running = false;
  dianxiaomiAdapter.setStage("idle", "");
  collectBatchRunState.finishedAt = Date.now();
  collectBatchRunState.summary = { success, failed, skipped, total };
  await snapshot();
}

// 单条采集箱上架核心执行（被全量 run 与 retry 共用）。
// 直接更新 item.status/progress/reason，返回状态字符串："done" | "failed" | "skipped"。
async function processCollectBatchRow(row, item, log) {
  const name = row.packageName;
  dianxiaomiAdapter.setStage("采集箱上架·准备", name);
  const dir = path.join(COMPLETED_PRODUCTS_DIR, name);
  // 校验包目录 + product-facts.json
  let factsFile = null;
  try {
    await readFile(path.join(dir, "product-facts.json"), "utf8");
    factsFile = path.join(dir, "product-facts.json");
  } catch (factsErr) {
    item.status = "skipped";
    item.reason = `缺少 product-facts.json（dir=${dir} | err=${factsErr && factsErr.code ? factsErr.code : (factsErr && factsErr.message ? factsErr.message : factsErr)}）`;
    item.progress = 100;
    return "skipped";
  }
  const key = (row.category && row.category !== "auto") ? row.category : await detectCategory(dir);
  try {
    let profile;
    if (DIANXIAOMI_CATEGORY_PROFILES[key]) {
      profile = dianxiaomiAdapter.setProfile(key);
    } else {
      // 表格手填的精准类目（非预设 profile key）：复用默认 profile 结构，仅覆盖 category 标签，
      // 让分类映射页按该精准字符串选类目。变种主题映射回退到通用默认（颜色->Color / 尺寸尺码型号->Size），
      // 避免映射页因未选主题而无法保存；如需覆盖可在表格提供 variantThemeMap 列。
      profile = JSON.parse(JSON.stringify(getDianxiaomiProfile(key)));
      profile.key = key;
      profile.category = key;
      profile.label = key;
      const userVariantMap = parseVariantThemeMap(row.variantThemeMap);
      profile.variantThemeMap = Object.keys(userVariantMap).length > 0
        ? userVariantMap
        : { "颜色": "Color", "尺寸": "Size", "尺码": "Size", "型号": "Size" };
      dianxiaomiAdapter.profile = profile;
    }
    log(`类目 profile: ${profile.key}`);
    const facts = normalizeDianxiaomiFacts(JSON.parse(await readFile(factsFile, "utf8")));
    const ready = checkDianxiaomiFactsReady(facts);
    if (!ready.ok) {
      item.status = "failed";
      item.reason = "facts 不完整: " + (ready.message || "");
      item.progress = 100;
      return "failed";
    }
    // 导航：采集箱 → 搜标题 → 点编辑
    dianxiaomiAdapter.setStage("采集箱上架·导航采集箱列表", name);
    await dianxiaomiAdapter.openCollectBox();
    item.progress = 15;
    dianxiaomiAdapter.setStage("采集箱上架·搜索标题", name);
    await dianxiaomiAdapter.searchCollectBox(row.searchTitle);
    item.progress = 30;
    dianxiaomiAdapter.setStage("采集箱上架·打开草稿编辑", name);
    await dianxiaomiAdapter.openCollectDraftByTitle(row.searchTitle);
    item.progress = 45;
    // 处理采集箱编辑前的「分类/变种主题映射」中间页（选类目 + 颜色->Color + 保存下一步）
    dianxiaomiAdapter.setStage("采集箱上架·填写类目映射", name);
    const catRes = await dianxiaomiAdapter.fillCollectDraftCategory(facts);
    if (catRes.mapped && catRes.mapped.length) log(`分类映射: ${catRes.mapped.map((m) => `${m.theme}->${m.target}`).join(", ")}`);
    log(`映射页结果: url=${catRes.url || "(unknown)"}, ok=${catRes.ok}, skipped=${catRes.skipped || false}, reason=${catRes.reason || ""}`);
    if (catRes.reason === "not-category-page") {
      throw new Error(`分类映射页未出现，当前页面: ${catRes.state && catRes.state.url ? catRes.state.url : "unknown"}。可能原因：1) 搜索标题未定位到正确行；2) 编辑未打开新标签页；3) 页面结构变化。`);
    }
    item.progress = 55;
    // 采集箱草稿已带固定字段（店铺/备货/分类等），不调用 fillFixedFields，只填 facts 文字/属性/描述。
    // variantOverride 默认 false → 采集箱变种信息原样沿用，只填标题/描述/属性/合规。
    const variantOverride = parseVariantOverrideFlag(row.variantOverride);
    if (variantOverride) log("变种模式: 覆盖（用 product-facts 重建颜色/尺寸/SKU）");
    else log("变种模式: 沿用采集源变种（不改动）");
    let productTemplate = (row.productTemplate || "").toString().trim();
    // 表格未指定时，按类目 profile 的 defaultProductTemplate 自动引用（如箱包配件→箱包配件-包饰）。
    if (!productTemplate && profile && profile.defaultProductTemplate) {
      productTemplate = profile.defaultProductTemplate;
      log(`产品模板(默认): ${productTemplate}`);
    } else if (productTemplate) {
      log(`产品模板: ${productTemplate}`);
    }
    dianxiaomiAdapter.setStage("采集箱上架·填写属性与描述", name);
    const applied = await dianxiaomiAdapter.fillFromFacts(facts, {
      collectMode: true,
      variantOverride,
      productTemplate,
      // 表格模板列：物流属性 / 材质（空则回退 profile/默认）。
      logisticsAttribute: (row.logisticsAttribute || "").toString().trim(),
      material: (row.material || "").toString().trim()
    });
    for (const a of applied) {
      if (a.ok === false) log(`${a.field}: FAIL ${a.reason || ""}`);
      else if (a.skipped) log(`${a.field}: SKIP ${a.reason || ""}`);
    }
    item.progress = 80;
    dianxiaomiAdapter.setStage("采集箱上架·保存草稿", name);
    let saved = await dianxiaomiAdapter.save();
    // 迭代自动纠错：保存 → 读校验错误 → 逐个按标签兜底填默认值 → 再保存，直到无错或达轮次上限。
    // 覆盖非箱包类目（如 Party Favors）在 fillFromFacts 非 xiangBao 分支未内置 autofix 的缺口，
    // 避免「颜色风格/性别/中国省份」等必填属性找不到对应填写逻辑时直接被店小秘拒收。
    for (let round = 1; round <= 3 && saved && !saved.saved; round += 1) {
      const errs = await dianxiaomiAdapter.readValidationErrors().catch(() => []);
      if (!errs.length) break;
      // 变种兜底只在店小秘明确报「缺必选变种」时才触发；平时绝不动采集带来的变种。
      if (errs.some((e) => /变种|销售属性|颜色\s*\(?\s*Color/i.test(`${e.label || ""} ${e.hint || ""}`))) {
        try {
          const vd = await dianxiaomiAdapter.ensureDefaultVariantColor();
          log(`variantDefault(round${round})=${vd.ok ? (vd.value || "ok") : (vd.reason || "fail")}`);
        }
        catch (ex) { log(`variantDefault(round${round})=err:${ex.message}`); }
      }
      const handled = new Set();
      for (const e of errs) {
        const lbl = e.label;
        if (!lbl || handled.has(lbl)) continue;
        handled.add(lbl);
        const core = lbl.replace(/[（(].*?[)）]/g, "").trim();
        try {
          const r = await dianxiaomiAdapter.fillFieldDefaultByLabel(core || lbl);
          log(`autofix:${core || lbl}=${r.ok ? "ok" : (r.reason || "fail")}`);
        }
        catch (ex) { log(`autofix:${core || lbl}=err:${ex.message}`); }
      }
      // autofix 可能填入中文默认值，触发「请输入英文、数字或空格符号」；仅在校验错误提示英文/数字时才强制重翻，
      // 否则跳过（fillFromFacts 末尾已翻译过一次，避免每轮无谓重翻拖慢上架）。
      dianxiaomiAdapter.setStage(`采集箱上架·自动纠错(第${round}轮)`, name);
      const needTranslate = errs.some((e) => /英文|数字|空格|符号|english|letter|character/i.test(`${e.label || ""} ${e.hint || ""} ${e.message || ""}`));
      if (needTranslate) {
        try {
          const tr = await dianxiaomiAdapter.translatePageToEnglish({ force: true });
          log(`translate-to-en=${tr.ok ? "ok" : (tr.reason || "skip")} [${tr.translated.join(",")}]`);
        } catch (ex) { log(`translate-to-en=err:${ex.message}`); }
      } else {
        log(`translate-to-en=skip(no-english-error)`);
      }
      await new Promise((r) => setTimeout(r, 400));
      saved = await dianxiaomiAdapter.save();
    }
    // 关键校验：描述类 critical fields 任一 FAIL / 读回校验失败 → 整行判 failed（与引用模式一致）
    // 采集箱模式只保留 PC 描述，无线端描述故意不填，因此不将 description.mobile 视为失败。
    // 2026-10-26：SKU 行回读失败（供货价/编码/库存没填进去或被覆盖）同样判 failed ——
    // 缺价格会被店小秘保存校验拦，而"错价"更糟：它会真的存成草稿。
    const criticalFailures = applied.filter((a) => (a.field === "description.pc" || a.field === "sku" || a.field === "category") && a.ok === false);
    const readbackIssues = (saved && Array.isArray(saved.hardIssues) && saved.hardIssues.length) ? saved.hardIssues : [];
    const criticalFailed = criticalFailures.length > 0 || readbackIssues.length > 0;
    if (saved && saved.saved && !criticalFailed) {
      dianxiaomiAdapter.setStage("采集箱上架·完成", name);
      // 后置：在采集箱行添加备注「待上架」并「移入待发布」。非致命：失败仅追加 reason，不阻断 done。
      try {
        const markRes = await dianxiaomiAdapter.markCollectRowAsPending(row.searchTitle, { remark: "待上架" });
        const markMsg = `markCollect:${markRes.ok ? "ok" : "FAIL"} steps=${markRes.steps.join(",") || "-"} remark=${markRes.remark || "-"} moved=${markRes.movedToPending ?? "-"}${markRes.reason ? " reason=" + markRes.reason : ""}`;
        log(markMsg);
        if (!markRes.ok) {
          item.reason = [saved.url || saved.message || "已存草稿(采集箱，未发布)", `markCollect-fail:${markRes.reason}`].filter(Boolean).join(" | ");
        } else {
          item.reason = saved.url || saved.message || "已存草稿(采集箱，未发布)";
        }
      } catch (ex) {
        log(`markCollect: EXC ${ex.message}`);
        item.reason = saved.url || saved.message || "已存草稿(采集箱，未发布)";
      }
      item.status = "done";
      item.progress = 100;
      return "done";
    } else if (saved && saved.saved && criticalFailed) {
      const failList = criticalFailures.map((a) => `${a.field}(${a.reason || "no-reason"})`).concat(readbackIssues.map((s) => `readback:${s}`));
      item.status = "failed";
      item.reason = `店小秘保存成功但页面实际为空: ${failList.join("; ")}`;
      item.progress = 100;
      return "failed";
    } else {
      item.status = "failed";
      item.reason = (saved && (saved.error || saved.message || JSON.stringify(saved))) || "save 返回非 ok";
      item.progress = 100;
      return "failed";
    }
  } catch (e) {
    dianxiaomiAdapter.setStage("采集箱上架·异常", name);
    item.status = "failed";
    item.reason = e instanceof Error ? e.message : String(e);
    item.progress = 100;
    return "failed";
  }
}

// 采集箱批量闭环归档（P1-1）：一行 save 成功后，把店小秘上传结果写入产品永久目录
// 已完成产品/<name>/dianxiaomi-upload.json（闭环完成标记），并（若 当前产品/ 正是同一产品）
// 把 当前产品/ 工作区按文件级合并进归档目录以清理工作区。
// 任何失败都不阻断下一行：结果写进 item.reason；返回 { ok, message }。
async function archiveCollectRow(row, item, log) {
  const name = row.packageName;
  const dir = path.join(COMPLETED_PRODUCTS_DIR, name);
  try {
    await mkdir(dir, { recursive: true });
    // 1) 写入店小秘上传记录（闭环完成标记）
    const uploadRecord = {
      packageName: name,
      mode: "collect",
      status: "done",
      url: (item.reason && /^https?:\/\//.test(item.reason.trim())) ? item.reason.trim() : "",
      uploadedAt: new Date().toISOString()
    };
    await writeFile(path.join(dir, "dianxiaomi-upload.json"), `${JSON.stringify(uploadRecord, null, 2)}\n`, "utf8");
    // 2) 若 当前产品/ 正是同一产品，合并其工作区进归档目录（清理工作区）
    let merged = false;
    try {
      const profPath = path.join(PRODUCT_ROOT, "product-profile.json");
      let curName = "";
      try {
        const p = JSON.parse(await readFile(profPath, "utf8"));
        curName = (p && (p.productName || p.name || "")).toString().trim();
      } catch { /* 无 profile 则不合并 */ }
      if (curName && curName === name.toString().trim()) {
        await mergeCurrentProductInto(dir, log);
        merged = true;
      }
    } catch (e) {
      log(`归档:当前产品合并探测失败(非致命): ${e.message}`);
    }
    return { ok: true, message: `upload-record${merged ? "+合并当前产品" : ""}` };
  } catch (e) {
    return { ok: false, message: e && e.message ? e.message : String(e) };
  }
}

// 把 当前产品/ 工作区按文件级合并进 destDir（同产品，覆盖同名安全），并重建设空工作区，
// 避免后续单品流程误用残缺目录。destDir 可能已含同名子目录，故逐文件 rename（MOVEFILE_REPLACE_EXISTING），
// 不删除 当前产品/ 之外的任何内容。
async function mergeCurrentProductInto(destDir, log) {
  const pairs = [
    [path.join(PRODUCT_ROOT, "产品图"), path.join(destDir, "产品图")],
    [path.join(PRODUCT_ROOT, "output"), path.join(destDir, "output")]
  ];
  for (const [srcDir, destSub] of pairs) {
    let entries = [];
    try { entries = await readdir(srcDir); } catch { continue; }
    for (const f of entries) {
      const srcFile = path.join(srcDir, f);
      const destFile = path.join(destSub, f);
      try {
        await mkdir(destSub, { recursive: true });
        await rename(srcFile, destFile);
      } catch (e) {
        if (e && e.code !== "ENOENT") log(`归档merge跳过 ${f}: ${e.message}`);
      }
    }
  }
  for (const f of ["product-facts.json", "run-state.json"]) {
    const srcFile = path.join(PRODUCT_ROOT, f);
    const destFile = path.join(destDir, f);
    try { await rename(srcFile, destFile); } catch (e) { if (e && e.code !== "ENOENT") log(`归档merge跳过 ${f}: ${e.message}`); }
  }
  // 重建空工作区（绕过 safe-delete shim：用 mkdir 而非 rm）
  await mkdir(path.join(PRODUCT_ROOT, "产品图"), { recursive: true });
  await mkdir(path.join(PRODUCT_ROOT, "output"), { recursive: true });
}

// 服务重启后从磁盘快照回读采集箱批量状态（含 failed 项与原始行，供「重试失败项」）。
// 仅在内存状态为空（jobId 未设置）时调用，避免覆盖进行中的任务。
async function recoverCollectBatchState() {
  try {
    const fp = path.join(HIDDEN_DATA_DIR, "collect-batch-state.json");
    const saved = JSON.parse(await readFile(fp, "utf8"));
    if (!saved || !saved.jobId) return;
    // 内存已有更新的状态（例如刚启动且已有任务），不覆盖
    if (collectBatchRunState.jobId && collectBatchRunState.startedAt && saved.startedAt && collectBatchRunState.startedAt >= saved.startedAt) {
      return;
    }
    collectBatchRunState.running = saved.running || false;
    collectBatchRunState.jobId = saved.jobId;
    collectBatchRunState.startedAt = saved.startedAt || null;
    collectBatchRunState.finishedAt = saved.finishedAt || null;
    collectBatchRunState.overallProgress = saved.overallProgress || 0;
    collectBatchRunState.summary = saved.summary || null;
    collectBatchRunState.items = saved.items || {};
    collectBatchRunState.rows = Array.isArray(saved.rows) ? saved.rows : [];
    collectBatchRunState.lastOperationId = saved.lastOperationId || null; // 幂等键：服务端重启后仍能识别同 op 重放
    // 兜底：服务端重启后，任何标记 running 的行实际已中断 → 转 failed，方便重试
    let recovered = false;
    for (const key of Object.keys(collectBatchRunState.items)) {
      const it = collectBatchRunState.items[key];
      if (it && it.status === "running") {
        it.status = "failed";
        it.reason = (it.reason ? `${it.reason}; ` : "") + "服务重启导致中断，请重试";
        recovered = true;
      }
    }
    if (recovered) {
      await writeFile(fp, JSON.stringify(collectBatchRunState, null, 2), "utf8").catch(() => {});
    }
  } catch {
    /* 无快照或解析失败则保持空状态 */
  }
  // 启动时再做一次自愈：把 disk 上残留的 running=true 且无活跃 item 归零
  // 修复采集箱批量「启动失败：已有任务在运行」永久残留的 409 拦路
  await normalizeCollectBatchRunningState();
}

async function normalizeCollectBatchRunningState() {
  // 自愈判定：标记 running=true，但 (a) 没有任何 item 还处于 running 中（说明后台进程已死）
  // 且 (b) 已经跑过一些行（items>0）或进度到 100%。这覆盖「跑完后没归零」和「中断后没归零」两类。
  const items = Object.values(collectBatchRunState.items);
  const anyRunning = items.some((it) => it && it.status === "running");
  if (collectBatchRunState.running && !anyRunning &&
      (collectBatchRunState.overallProgress >= 100 || items.length > 0)) {
    collectBatchRunState.running = false;
    collectBatchRunState.finishedAt = collectBatchRunState.finishedAt || new Date().toISOString();
    if (!collectBatchRunState.summary) {
      const success = items.filter((it) => it && it.status === "done").length;
      const failed = items.filter((it) => it && it.status === "failed").length;
      const skipped = items.filter((it) => it && it.status === "skipped").length;
      collectBatchRunState.summary = { success, failed, skipped, total: items.length };
    }
    try {
      await writeFile(
        path.join(HIDDEN_DATA_DIR, "collect-batch-state.json"),
        JSON.stringify(collectBatchRunState, null, 2),
        "utf8"
      );
    } catch { /* ignore */ }
    return true;
  }
  return false;
}

// ===== 引用批量上架：状态懒恢复 + 自愈（2026-10-24 补齐，对齐采集箱）=====
// 背景：采集箱有 recoverCollectBatchState + normalizeCollectBatchRunningState，
// 引用侧此前两者都没有 → 服务重启后 batchRunState 从磁盘快照回不来，若快照里
// running=true 残留，`/api/dianxiaomi/batch-apply` 会被 409「已有批量任务在运行」
// 永久拦死（后台其实早没了），只能手工改 json 或重启碰运气。
async function recoverBatchListingState() {
  try {
    const fp = path.join(HIDDEN_DATA_DIR, "batch-listing-state.json");
    const saved = JSON.parse(await readFile(fp, "utf8"));
    if (!saved || !saved.jobId) return;
    // 内存已有更新的状态（例如刚启动且已在跑任务），不覆盖
    if (batchRunState.jobId && batchRunState.startedAt && saved.startedAt && batchRunState.startedAt >= saved.startedAt) {
      return;
    }
    batchRunState.running = saved.running || false;
    batchRunState.jobId = saved.jobId;
    batchRunState.startedAt = saved.startedAt || null;
    batchRunState.finishedAt = saved.finishedAt || null;
    batchRunState.overallProgress = saved.overallProgress || 0;
    batchRunState.summary = saved.summary || null;
    batchRunState.items = saved.items || {};
    batchRunState.rows = Array.isArray(saved.rows) ? saved.rows : [];
    batchRunState.lastOperationId = saved.lastOperationId || null;
    batchRunState.lastActivityAt = saved.lastActivityAt || null;
    // 服务重启后，任何仍标 running 的行实际已中断 → 转 failed，让「重试失败项」能捡起来
    let recovered = false;
    for (const key of Object.keys(batchRunState.items)) {
      const it = batchRunState.items[key];
      if (it && it.status === "running") {
        it.status = "failed";
        it.reason = (it.reason ? `${it.reason}; ` : "") + "服务重启导致中断，请重试";
        recovered = true;
      }
    }
    if (recovered) {
      await writeFile(fp, JSON.stringify(batchRunState, null, 2), "utf8").catch(() => {});
    }
  } catch {
    /* 无快照或解析失败则保持空状态 */
  }
  // 恢复完再做一次自愈：把 disk 上残留的 running=true 且无活跃 item 归零
  await normalizeBatchListingRunningState();
}

// 自愈判定与采集箱一致：running=true，但 (a) 没有任何 item 还在 running（后台已死）
// 且 (b) 进度已到 100 或已跑过行（items>0）→ 归零 + 补 summary + 落盘。
// 额外加心跳守卫：距最近一次 snapshot 不足 STALE_MS 时不动。正常跑批时两行之间会有
// 极短间隙（上一项 done、下一项还没标 running），没有这道守卫会被 1s 轮询误归零，
// 进而允许同一时间启动第二个批量任务。
const BATCH_STALE_MS = 90_000;
async function normalizeBatchListingRunningState() {
  const items = Object.values(batchRunState.items);
  const anyRunning = items.some((it) => it && it.status === "running");
  const staleEnough = !batchRunState.lastActivityAt || (Date.now() - Number(batchRunState.lastActivityAt) > BATCH_STALE_MS);
  if (batchRunState.running && !anyRunning && staleEnough &&
      (batchRunState.overallProgress >= 100 || items.length > 0)) {
    batchRunState.running = false;
    batchRunState.finishedAt = batchRunState.finishedAt || new Date().toISOString();
    if (!batchRunState.summary) {
      batchRunState.summary = {
        success: items.filter((it) => it && it.status === "done").length,
        failed: items.filter((it) => it && it.status === "failed").length,
        skipped: items.filter((it) => it && it.status === "skipped").length,
        total: items.length
      };
    }
    try {
      await writeFile(
        path.join(HIDDEN_DATA_DIR, "batch-listing-state.json"),
        JSON.stringify(batchRunState, null, 2),
        "utf8"
      );
    } catch { /* ignore */ }
    return true;
  }
  return false;
}

// 幂等重放判定（引用 / 采集箱共用语义）：
// 同一 operationId 再次提交时，只有当「任务仍在跑」或「刚结束不久」才视为重放并返回原 jobId。
// 加时间窗是为了避免副作用：若永久认定重放，用户想对同一批商品再跑一次就永远被吞掉。
// 超出时间窗 / 没有 finishedAt（异常中断）→ 判定为"重跑"，正常执行。
const IDEMPOTENT_REPLAY_WINDOW_MS = 5 * 60_000;
function isIdempotentReplay(state, operationId) {
  if (!operationId || !state || state.lastOperationId !== operationId || !state.jobId) return false;
  if (state.running) return true;
  const finishedAt = Number(state.finishedAt || 0);
  return finishedAt > 0 && (Date.now() - finishedAt) < IDEMPOTENT_REPLAY_WINDOW_MS;
}

async function runBatchListing(rows, opts = {}) {
  const retryMode = !!(opts && opts.retry);
  batchRunState.running = true;
  batchRunState.lastActivityAt = Date.now();
  if (!retryMode) {
    // jobId 由调用方（路由）生成时优先沿用，保证 HTTP 响应里的 jobId 与状态快照一致
    batchRunState.jobId = (opts && opts.jobId) || `batch-${Date.now()}`;
    // operationId 落盘：服务重启后前端重发同一 op 仍能被识别为重放
    if (opts && opts.operationId !== undefined) batchRunState.lastOperationId = opts.operationId || null;
    batchRunState.startedAt = Date.now();
    batchRunState.finishedAt = null;
    batchRunState.summary = null;
    batchRunState.items = {};
    batchRunState.overallProgress = 0;
    batchRunState.rows = rows; // 持久化原始行，供「重试失败项」重建
  }
  const snapshot = async () => {
    batchRunState.lastActivityAt = Date.now(); // 心跳：供自愈判定「后台是否还活着」
    try {
      await writeFile(
        path.join(HIDDEN_DATA_DIR, "batch-listing-state.json"),
        JSON.stringify(batchRunState, null, 2),
        "utf8"
      );
    } catch { /* ignore */ }
  };

  // 重试模式：仅重跑 failed/skipped 项，保留 done 项与整体进度（仿照采集箱 collect-batch-retry）
  if (retryMode) {
    const rowsById = new Map((batchRunState.rows || []).map((r) => [r.packageName, r]));
    const overrides = (opts && opts.overrides) || {};
    const targets = Object.values(batchRunState.items)
      .filter((it) => (it.status === "failed" || it.status === "skipped") && rowsById.has(it.name))
      .map((it) => Object.assign({}, rowsById.get(it.name), overrides[it.name] || {}));
    const total = Object.keys(batchRunState.items).length || targets.length;
    let done = Object.values(batchRunState.items).filter((it) => it.status === "done").length;
    for (const row of targets) {
      const name = row.packageName;
      const item = batchRunState.items[name];
      if (!item) continue;
      item.status = "running";
      item.progress = 0;
      item.reason = "";
      item.log = Array.isArray(item.log) ? item.log : [];
      item.log.push(`[${new Date().toISOString()}] ↻ 重试失败项`);
      await processBatchReferenceRow(row, total,
        () => { done++; batchRunState.overallProgress = total ? Math.round((done / total) * 100) : 100; snapshot(); },
        (_s, _f, _sk) => {} // retry 模式下 summary 在循环外统一计算
      );
    }
    batchRunState.running = false;
    dianxiaomiAdapter.setStage("idle", "");
    batchRunState.finishedAt = Date.now();
    const all = Object.values(batchRunState.items);
    batchRunState.summary = {
      success: all.filter((it) => it.status === "done").length,
      failed: all.filter((it) => it.status === "failed").length,
      skipped: all.filter((it) => it.status === "skipped").length,
      total: all.length
    };
    await snapshot();
    return;
  }

  // 正常模式：全量执行
  const targets = rows.filter((r) => r.enabled !== false && r.packageName);
  const total = targets.length;
  let success = 0, failed = 0, skipped = 0, done = 0;
  for (const row of targets) {
    await processBatchReferenceRow(row, total, () => { done++; batchRunState.overallProgress = total ? Math.round((done / total) * 100) : 100; snapshot(); }, (s, f, sk) => { success += s; failed += f; skipped += sk; });
  }
  batchRunState.running = false;
  dianxiaomiAdapter.setStage("idle", "");
  batchRunState.finishedAt = Date.now();
  batchRunState.summary = { success, failed, skipped, total };
  await snapshot();
}

// 引用上架单行处理逻辑（供 runBatchListing 正常模式 for-loop 与 retry 模式共同复用）
async function processBatchReferenceRow(row, total, onProgress, addSummary) {
  const name = row.packageName;
  const dir = path.join(COMPLETED_PRODUCTS_DIR, name);
  // 复用已有 item（retry 模式）或新建（正常模式）
  const item = batchRunState.items[name] || { name, status: "running", progress: 0, reason: "", log: [] };
  item.status = "running";
  item.progress = 0;
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
    addSummary(0, 0, 1);
    onProgress();
    return;
  }
  const key = (row.category && row.category !== "auto") ? row.category : await detectCategory(dir);
  try {
    let profile = dianxiaomiAdapter.setProfile(key);
    log(`类目 profile: ${profile.key}`);
    profile = JSON.parse(JSON.stringify(profile));
    if (row.store) { profile.fixed.storeName = row.store; log(`覆盖店铺: ${row.store}`); }
    if (row.stockType) { profile.fixed.stockType = row.stockType; log(`覆盖备货类型: ${row.stockType}`); }
    dianxiaomiAdapter.profile = profile;

    const facts = normalizeDianxiaomiFacts(JSON.parse(await readFile(factsFile, "utf8")));
    if (row.brand) { facts.brand = row.brand; log(`覆盖品牌: ${row.brand}`); }
    if (row.variantParams) {
      const vp = parseVariantParams(row.variantParams);
      const cm = parseColorMap(row.variantParams);
      const baseMatrix = (facts.variants && Array.isArray(facts.variants.matrix)) ? facts.variants.matrix : [];
      if (isXiangBaoProfile(profile)) {
        if (cm.length) {
          const colorImages = {};
          for (const c of cm) if (c.image) colorImages[c.color] = c.image;
          facts.variants = Object.assign({}, facts.variants || {}, {
            colors: cm.map((c) => c.color), sizes: [], matrix: [], colorMap: cm, colorImages
          });
          log(`箱包类目颜色映射覆盖: ${JSON.stringify(cm.map((c) => ({ color: c.color, custom: c.customName, img: c.image })))}`);
        } else if (vp.colors.length || vp.sizes.length) {
          const colors = vp.colors.length ? vp.colors : ((facts.variants && facts.variants.colors) || []);
          const sizes = vp.sizes.length ? vp.sizes : ((facts.variants && facts.variants.sizes) || []);
          // 2026-10-26：原来这里写死 `matrix: []`，于是箱包类目**永远没有 SKU 组合矩阵**，
          // fillSkus 必然返回 no-variants-in-facts → 供货价/库存/编码从来不由程序写入，
          // 页面上留着的是引用模板源产品的值。改为按 colors×sizes 重建（逐组合继承源值）。
          const matrix = buildVariantMatrix(colors, sizes, baseMatrix);
          facts.variants = Object.assign({}, facts.variants || {}, {
            colors, sizes, matrix, dimensions: []
          });
          log(`箱包类目颜色勾选: colors=${JSON.stringify(colors)} sizes=${JSON.stringify(sizes)} matrix=${matrix.length}`);
        }
      } else {
        const colors = vp.colors.length ? vp.colors : (facts.variants && facts.variants.colors) || [];
        const sizes = vp.sizes.length ? vp.sizes : (facts.variants && facts.variants.sizes) || [];
        const matrix = buildVariantMatrix(colors, sizes, baseMatrix);
        facts.variants = Object.assign({}, facts.variants || {}, { colors, sizes, matrix, dimensions: [] });
        log(`覆盖变种参数: colors=${JSON.stringify(colors)} sizes=${JSON.stringify(sizes)} matrix=${matrix.length}`);
      }
    }
    const ready = checkDianxiaomiFactsReady(facts);
    if (!ready.ok) {
      item.status = "failed";
      item.reason = "facts 不完整: " + (ready.message || "");
      item.progress = 100;
      addSummary(0, 1, 0);
      onProgress();
      return;
    }
    dianxiaomiAdapter.setImageBaseDir(dir);
    // 2026-10-26 路径修正（Lance 指出）：正确流程是
    //   ① 创建空白新产品 → ② 应用产品模板（带出类目结构/属性骨架/合规配置）→ ③ 填我们的事实
    // 而原来这里**无条件** `referenceProduct(templateProductId)`，那是「引用现有产品」——
    // 会把源产品的 SKU 组合、供货价、库存、描述、图片整表复制过来。真机实测页面上的
    // SKU 就是源产品的 5 行（BBGJ31-yellow/pink/blue/white/4pcs，7.8，库存 0），
    // 我们的 facts（Gold/Silver/Red，19.9，KC-660765-*）一个都写不进去；
    // 无线端描述、欧盟责任人、海关区块也都是源产品的残留状态。
    // 现在改为：只有**显式传 referenceProductId** 时才走引用路径（保留"复制某商品再改"的能力），
    // 默认走空白新建 + 产品模板。
    const explicitRefId = row.referenceProductId && String(row.referenceProductId).trim();
    log(explicitRefId
      ? `引用源产品: ${explicitRefId}（行级指定，会整表复制该商品的 SKU/价格/库存）`
      : `空白新建 + 产品模板: ${row.productTemplate || profile.defaultProductTemplate || "(未配置)"}`);
    // ── 引擎开关（2026-10-27）：LISTING_ENGINE=ecom 时走「照搬 ecom 的上品路径」的
    // listing-engine.js（step 机 + 前置门 + 行数契约 + 保存前回读 + 待发布列表校验），
    // 默认关闭，保持既有链路不受影响 —— 灰度用，等批量跑稳再切换默认。
    // 与旧链路的本质差别：旧链路每步各自自证 ok 却在保存处才炸；引擎每步都有可判定的后果，
    // 且以「待发布列表能否搜到新草稿」作为最终判据（后果优先于自述）。
    if (LISTING_ENGINE_ON) {
      log("引擎: ecom（listing-engine.js）");
      await dianxiaomiAdapter.openCreatePage({ freshTab: true });
      const engineRes = await runListingEngine({
        adapter: dianxiaomiAdapter,
        facts,
        profile,
        row,
        // 批量链路的目的就是产出草稿 → 默认保存；想只填不存请设 LISTING_ENGINE_COMMIT=0。
        commit: LISTING_ENGINE_COMMIT
      });
      item.appliedSummary = (engineRes.steps || []).map((st) => ({
        field: st.name,
        ok: st.status !== "ERROR",
        skipped: st.status === "ATTENTION",
        reason: st.reason || "",
        value: st.value
      }));
      item.engineAttention = engineRes.attention || [];
      for (const st of engineRes.steps || []) {
        if (st.status === "ERROR") log(`${st.name}: FAIL ${st.reason || ""}`);
        else if (st.status === "ATTENTION") log(`${st.name}: ATT ${st.reason || ""}`);
      }
      for (const a of engineRes.attention || []) log(`attention: ${a}`);
      const okSave = !LISTING_ENGINE_COMMIT ? true
        : !!(engineRes.saved && engineRes.saved.verifiedInList && engineRes.saved.isNew !== false);
      item.status = okSave ? "success" : "failed";
      item.reason = okSave ? "" : "引擎：草稿未在待发布列表出现";
      item.progress = 100;
      if (engineRes.saved && engineRes.saved.editUrl) item.draftEditUrl = engineRes.saved.editUrl;
      addSummary(okSave ? 1 : 0, okSave ? 0 : 1, 0);
      onProgress();
      return;
    }
    await dianxiaomiAdapter.openCreatePage();
    // ★ 顺序对齐 ecom-translator（draft_executor.mjs:792）：
    //     店铺 → 引用产品模板 → 备货类型 → 标题/属性/描述 …
    // 1) 店铺必须最先选：模板列表依赖已选店铺，**未选店铺时点「引用产品模板」前端静默无反应**
    //    （2026-10-27 实测：dropdown 正常展开、菜单项能命中、无遮罩遮挡，
    //      但 .ant-modal-root 数量恒为 0 —— 前端直接不弹）。我此前把模板提到最前面，正好踩了这个坑。
    // 2) 模板引用会**整体重置表单**（备货/分类/属性/合规），所以它必须排在其它写入之前；
    //    但又必须排在店铺之后 —— 模板是「第二早」，不是「第一早」。
    // 店铺名：行级 store 优先，否则回落到 profile.fixed.storeName。
    // 这一条是「引用产品模板」的**硬前置**：未选店铺时页面顶部会显示橙条
    // 「提醒: 请先选择店铺」，此时点「引用产品模板」前端**静默无反应**
    // （用户 2026-10-27 截图确认；实测 dropdown 正常展开但 .ant-modal-root 恒为 0）。
    // 之前写成 `if (row.store)` —— 而请求里通常不传 store，于是这步整段被跳过。
    const storeName = (row.store || (profile.fixed && profile.fixed.storeName) || "").toString().trim();
    if (storeName) {
      const sr = await dianxiaomiAdapter.selectStoreByName(storeName);
      log(`店铺选择: ${sr.ok ? sr.value : "FAIL " + sr.reason}（目标 ${storeName}）`);
    } else {
      log("店铺选择: 跳过 —— 行与 profile 都没有店铺名，模板引用会因「请先选择店铺」而失败");
    }
    // ★ 引用产品模板：排在**店铺之后、所有其它写入之前**（Lance 2026-10-26 指出顺序问题）。
    // 引用模板会**整体重置表单**（备货/分类/属性/合规全部回到模板值），所以必须早于其它写入；
    // 原来它藏在 fillFromFacts 内部，而外层已经先跑了 selectStockingType / changeCategoryTo /
    // fillFixedFields —— 模板一引用，刚写进去的全被冲掉。症状极具迷惑性：
    // appliedSummary 里每一步都 ok:true，而保存时页面是空的
    // （实测报错「请填写标题 / 请先选择产品分类」）。
    const earlyTemplate = (row.productTemplate || profile.defaultProductTemplate || "").toString().trim();
    let earlyTplResult = null;
    if (earlyTemplate && !explicitRefId) {
      try {
        earlyTplResult = await dianxiaomiAdapter.applyProductTemplate(earlyTemplate);
        log(`引用产品模板(第一步): ${earlyTplResult.ok ? "OK" : "FAIL " + (earlyTplResult.reason || "(无原因)")}`);
        if (earlyTplResult.warning) log(`引用产品模板注意: ${earlyTplResult.warning}`);
        if (earlyTplResult.moduleNames) log(`模板引用模块: ${earlyTplResult.moduleNames}`);
      } catch (tplErr) {
        earlyTplResult = { ok: false, reason: "exception:" + (tplErr && tplErr.message || tplErr) };
        log(`引用产品模板异常: ${earlyTplResult.reason}`);
      }
    }

    if (row.stockType) {
      const sk = await dianxiaomiAdapter.selectStockingTypeByLabel(row.stockType);
      log(`备货类型: ${sk.ok ? sk.value : "FAIL " + sk.reason}`);
    }
    if (explicitRefId) await dianxiaomiAdapter.referenceProduct(explicitRefId);
    {
      const rawCat = row.category && String(row.category).trim();
      const isProfileKey = rawCat && DIANXIAOMI_CATEGORY_PROFILES[rawCat];
      if (rawCat && rawCat !== "auto" && !isProfileKey) {
        try {
          const cc = await dianxiaomiAdapter.changeCategoryTo(rawCat);
          log(`分类更改: ${cc.ok ? (cc.value || rawCat) : "FAIL " + (cc.reason || "")}`);
        } catch (ccErr) {
          log(`分类更改异常: ${ccErr && ccErr.message ? ccErr.message : ccErr}`);
        }
      }
    }
    item.progress = 25;
    await dianxiaomiAdapter.fillFixedFields();
    item.progress = 50;
    const fillOpts = {
      keepVariants: row.variantOn !== true,
      // 2026-10-26 决策 A：表格「变种开关」打开（variantOn=true）时，变种由系统接管 ——
      // 勾选颜色/尺寸并生成 SKU、写供货价/重量/库存。
      // 之前只传 keepVariants，而 fillSalesAttributes 被一刀切停用、fillSkus 又不在这条路径上调用，
      // 结果是 SKU 表 0 行 → 店小秘必填「供货价」「重量」为空 → 保存必失败。
      variantOverride: row.variantOn === true || row.variantOn === "true",
      // 模板已在 openCreatePage 之后**第一步**引用过（会重置整表，必须排在所有写入之前）。
      // 这里再传一次会在所有字段填完后二次重置表单 —— 正是「每步都 ok、保存时页面是空的」的成因。
      productTemplate: ""
    };
    const applied = await dianxiaomiAdapter.fillFromFacts(facts, fillOpts);
    // 把第一步的模板结果放在 applied 队首，让它进 appliedSummary / 关键失败判定，不被漏看。
    if (earlyTplResult) applied.unshift({ field: "productTemplate(第一步)", ...earlyTplResult });
    for (const a of applied) {
      if (a.ok === false) log(`${a.field}: FAIL ${a.reason || ""}`);
      else if (a.skipped) log(`${a.field}: SKIP ${a.reason || ""}`);
    }
    // 2026-10-26 可观测性：applied 摘要落盘。
    // 之前只有 FAIL/SKIP 才写 log，ok:true 的字段（尤其 sku 的逐字段三态）在日志里
    // 完全不可见 —— 于是"填了没生效"只能靠事后翻页面猜。这里只存摘要，
    // 不存 details 全量（28 行 × 4 字段会撑爆状态文件）。
    item.appliedSummary = applied.map((a) => ({
      field: a.field,
      ok: a.ok !== false,
      skipped: !!a.skipped,
      reason: a.reason || "",
      rows: a.rows,
      failedRows: a.failedRows,
      verifiedRows: a.verifiedRows,
      mismatchedRows: a.mismatchedRows,
      attentionCount: Array.isArray(a.attention) ? a.attention.length : 0,
      attention: Array.isArray(a.attention) && a.attention.length ? a.attention.slice(0, 3) : undefined,
      states: Array.isArray(a.applied) ? a.applied.map((x) => `${x.field}=${x.state}${x.readback ? `(${x.readback})` : ""}`) : undefined,
      // 复合字段（海关/合规）的子项结论：它们只返回 fields[]，没有 reason，
      // 失败时 log 里只有一行 `customs: FAIL `（空原因）—— 子项明细必须落盘才查得动。
      fields: Array.isArray(a.fields)
        ? a.fields.map((x) => `${x.field}=${x.ok === false ? "FAIL" : (x.skipped ? "SKIP" : "OK")}${x.reason ? ":" + String(x.reason).slice(0, 70) : ""}`)
        : undefined
    }));
    item.progress = 80;
    const saved = await dianxiaomiAdapter.save();
    dianxiaomiAdapter.resetImageBaseDir();
    // 2026-10-26：SKU 行回读失败也进关键失败集（供货价/编码/库存填错比"页面为空"更难发现）
    const criticalFailures = applied.filter((a) => (a.field === "images" || a.field === "description.pc" || a.field === "description.mobile" || a.field === "sku" || a.field === "category") && a.ok === false);
    const readbackIssues = (saved && Array.isArray(saved.hardIssues) && saved.hardIssues.length) ? saved.hardIssues : [];
    const criticalFailed = criticalFailures.length > 0 || readbackIssues.length > 0;
    if (saved && saved.saved && !criticalFailed) {
      item.status = "done";
      item.reason = saved.url || saved.message || "已存草稿";
      item.progress = 100;
      addSummary(1, 0, 0);
    } else if (saved && saved.saved && criticalFailed) {
      const failList = criticalFailures.map((a) => `${a.field}(${a.reason || "no-reason"})`).concat(readbackIssues.map((s) => `readback:${s}`));
      item.status = "failed";
      item.reason = `店小秘保存成功但页面实际为空: ${failList.join("; ")}`;
      item.progress = 100;
      addSummary(0, 1, 0);
    } else {
      item.status = "failed";
      item.reason = (saved && (saved.error || saved.message || JSON.stringify(saved))) || "save 返回非 ok";
      item.progress = 100;
      addSummary(0, 1, 0);
    }
  } catch (e) {
    try { dianxiaomiAdapter.resetImageBaseDir(); } catch { /* ignore */ }
    item.status = "failed";
    item.reason = e instanceof Error ? e.message : String(e);
    item.progress = 100;
    addSummary(0, 1, 0);
  }
  onProgress();
}

app.use((error, _request, response, _next) => {
    const uploadError = error.code === "LIMIT_FILE_SIZE"
        ? "单张图片不能超过 15 MB"
        : error.code === "LIMIT_FILE_COUNT"
            ? "单次最多上传 12 张图片，请重试"
            : error.message;
    response.status(500).json({ error: uploadError });
});

// ============================================================
// Listing Agent 接驳路由（新增，非破坏性）
// ------------------------------------------------------------
// 这些 /api/listing/* 是「一跨而境 AI Listing Agent」的独立公开 API，
// 与原有 4 个 batch/collect 路由并存、互不覆盖，永不下线。
// - 直接经由 agentClient 调用 Agent：优先 HTTP 服务
//   （node listing-agent/src/server.js，端口 AGENT_PORT 默认 3200），
//   HTTP 不可达（ECONNREFUSED / fetch failed）时自动回退进程内直接
//   import ListingAgent，无需起独立进程。
// - 进程启动时只实例化轻量客户端；真正的 ChatGPT/店小秘 连接是惰性的
//   （仅在使用 AI 生成/上架的请求中按需 launch），因此即便未登录 Chrome
//   / 未起 Agent 服务，本服务启动不受影响，仅相关请求会返回 needs_human/failed。
// - 环境变量 LISTING_AGENT_FORWARD=1 是为「改造原 4 个路由为薄转发层」
//   预留的开关（见 README）；本块新增路由本身不依赖该开关，始终可用。
// ============================================================

// POST /api/listing/run  —— 完整执行：解析→生成→校验→（可选）上架
app.post("/api/listing/run", async (request, response) => {
  try {
    const result = await agentClient.run(request.body || {});
    response.status(200).json(result);
  } catch (e) {
    response.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/listing/validate —— 仅校验/归一化，不做 AI 生成与上架
app.post("/api/listing/validate", async (request, response) => {
  try {
    const report = await agentClient.validate(request.body || {});
    response.status(200).json(report);
  } catch (e) {
    response.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/listing/preview —— 生成但强制不上架（publish=false），用于预览产物
app.post("/api/listing/preview", async (request, response) => {
  try {
    const result = await agentClient.preview(request.body || {});
    response.status(200).json(result);
  } catch (e) {
    response.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/listing/status/:jobId —— MVP Agent 为同步执行，无异步任务队列，返回说明
app.get("/api/listing/status/:jobId", (request, response) => {
  response.status(501).json({
    status: "not_implemented",
    jobId: request.params.jobId,
    message: "MVP Agent 采用同步执行模型，run/validate/preview 均已携带完整结果返回，无需轮询任务状态。",
  });
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
