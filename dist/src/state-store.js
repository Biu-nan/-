import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { STATE_FILE } from "./config.js";
import { normalizeGenerationQcResult } from "./storyboard-gate-service.js";
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
    imageCount: 0,
    imageNames: [],
    updatedAt: new Date().toISOString()
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
    setUpdateObserver(observer) {
        this.updateObserver = observer;
    }
    async load() {
        try {
            const data = JSON.parse(await readFile(STATE_FILE, "utf8"));
            const promptPackQc = normalizeGenerationQcResult(data.promptPackQc) ?? data.promptPackQc;
            this.state = {
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
        }
        catch {
            this.state = initialState();
        }
        await this.save();
        return this.get();
    }
    get() {
        return structuredClone(this.state);
    }
    async update(patch) {
        this.state = {
            ...this.state,
            ...patch,
            updatedAt: new Date().toISOString()
        };
        await this.save();
        await this.notifyObserver();
        return this.get();
    }
    async reset(message = "等待导入下一个产品") {
        this.state = {
            ...initialState(),
            message
        };
        await this.save();
        await this.notifyObserver();
        return this.get();
    }
    async notifyObserver() {
        if (!this.updateObserver)
            return;
        try {
            await this.updateObserver(this.get());
        }
        catch (error) {
            console.warn("Product profile observer warning:", error instanceof Error ? error.message : String(error));
        }
    }
    async save() {
        await mkdir(path.dirname(STATE_FILE), { recursive: true });
        await writeFile(STATE_FILE, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    }
}
//# sourceMappingURL=state-store.js.map