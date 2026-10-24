import { STATE_FILE } from "./config.js";
import { normalizeGenerationQcResult } from "./storyboard-gate-service.js";
import { readCheckedJson, writeCheckedJson } from "./reliability/json-store.js";
const initialState = () => ({
    stage: "IDLE",
    message: "等待启动",
    running: false,
    autoRun: false,
    pauseRequested: false,
    workflowMode: "standard_listing",
    standardWorkflowGoal: "full_listing",
    researchCompleted: false,
    browserStarted: false,
    provider: "chatgpt",
    skipProductFacts: false,
    skipResearch: false,
    imageCount: 0,
    imageNames: [],
    objectiveInfo: "",
    updatedAt: new Date().toISOString(),
    selection: {
        running: false,
        stage: "IDLE",
        input: null,
        text: "",
        candidates: [],
        updatedAt: null,
        chatUrl: null,
        decided: {},
        error: undefined
    }
});
function normalizePostGenerationQc(value) {
    if (!value)
        return value;
    return Object.fromEntries(Object.entries(value).map(([imageNumber, result]) => [
        imageNumber,
        normalizeGenerationQcResult(result) ?? result
    ]));
}
function normalizePersistedError(error, promptPackQc) {
    if (!error?.includes("[object Object]") || !promptPackQc?.errors.length)
        return error;
    return `Storyboard QC 未通过：${promptPackQc.errors.join("；")}`;
}
export class StateStore {
    state = initialState();
    updateObserver;
    pending = Promise.resolve();
    starting = new Set();
    constructor({ stateFile = STATE_FILE } = {}) {
        this.stateFile = stateFile;
    }
    enqueue(operation) {
        const next = this.pending.then(operation);
        this.pending = next.catch(() => undefined);
        return next;
    }
    persist(value) {
        return writeCheckedJson(this.stateFile, value, { validate: isValidState });
    }
    setUpdateObserver(observer) {
        this.updateObserver = observer;
    }
    async load() {
        return this.enqueue(async () => {
            const loaded = await readCheckedJson(this.stateFile, { validate: isValidState });
            let next = initialState();
            if (loaded.found) {
                const data = loaded.value;
                const promptPackQc = normalizeGenerationQcResult(data.promptPackQc) ?? data.promptPackQc;
                next = {
                ...initialState(),
                ...data,
                promptPackQc,
                currentPreGenerationQc: normalizeGenerationQcResult(data.currentPreGenerationQc) ??
                    data.currentPreGenerationQc,
                postGenerationQc: normalizePostGenerationQc(data.postGenerationQc),
                workflowMode: data.workflowMode ?? "standard_listing",
                standardWorkflowGoal: data.standardWorkflowGoal ?? "full_listing",
                researchCompleted: data.researchCompleted ?? Boolean(data.researchText),
                stage: data.running ? "PAUSED" : data.stage,
                interruptedStage: data.running ? data.stage : data.interruptedStage,
                message: data.running
                    ? "检测到上次运行被中断，可从断点继续"
                    : data.message,
                error: data.running
                    ? "本地服务或浏览器在任务运行期间中断"
                    : normalizePersistedError(data.error, promptPackQc),
                running: false,
                autoRun: false,
                pauseRequested: false,
                browserStarted: false,
                updatedAt: new Date().toISOString()
                };
                if (loaded.recovered) next.message = `已从有效快照恢复；${next.message}`;
            }
            await this.persist(next);
            this.state = next;
            return this.get();
        });
    }
    get() {
        const view = structuredClone(this.state);
        // running兼作旧入口的会话互斥。先同步预留启动，不提前发布阶段/产物状态。
        if (this.starting.has("workflow")) view.running = true;
        if (this.starting.has("selection")) view.selection = { ...view.selection, running: true };
        return view;
    }
    async update(patch) {
        const snapshot = structuredClone(patch);
        const claims = [];
        if (snapshot.running === true && !this.state.running) claims.push("workflow");
        if (snapshot.selection?.running === true && !this.state.selection?.running) claims.push("selection");
        if (claims.some(key => this.starting.has(key))) throw new Error("当前已有任务正在启动");
        for (const key of claims) this.starting.add(key);
        return this.enqueue(async () => {
            const next = {
                ...this.state,
                ...snapshot,
                updatedAt: new Date().toISOString()
            };
            await this.persist(next);
            this.state = next;
            await this.notifyObserver();
            return this.get();
        }).finally(() => { for (const key of claims) this.starting.delete(key); });
    }
    async reset(message = "等待导入下一个产品") {
        return this.enqueue(async () => {
            const next = {
                ...initialState(),
                message
            };
            await this.persist(next);
            this.state = next;
            await this.notifyObserver();
            return this.get();
        });
    }
    async notifyObserver() {
        if (!this.updateObserver)
            return;
        // Fire-and-forget: do NOT await the observer. The product-profile sync
        // runs on its own serialized queue and is best-effort. Awaiting it here
        // would block state persistence (and any HTTP handler that calls
        // store.update/reset) whenever that queue is slow or stuck, which hangs
        // the client with no response. Errors are logged, never rethrown.
        Promise.resolve()
            .then(() => this.updateObserver(this.get()))
            .catch((error) => console.warn("Product profile observer warning:", error instanceof Error ? error.message : String(error)));
    }
    async save() {
        return this.enqueue(() => this.persist(this.state));
    }
}
function isValidState(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) &&
        typeof value.stage === "string" && value.stage.length > 0 && typeof value.running === "boolean";
}
//# sourceMappingURL=state-store.js.map
