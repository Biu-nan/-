import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { OUTPUT_DIR, PRODUCT_IMAGES_DIR, PRODUCT_PROFILE_FILE, PRODUCT_QUEUE_DIR, PRODUCT_QUEUE_STATE_FILE, PRODUCT_QUEUE_TASKS_DIR } from "./config.js";
import { importImageUrlsToDirectory, scanImages } from "./directory-images.js";
import { archiveCurrentProduct } from "./product-session.js";
const MAX_QUEUE_ROWS = 100;
function initialQueueState() {
    const now = new Date().toISOString();
    return {
        schemaVersion: "1.0",
        status: "idle",
        pauseRequested: false,
        tasks: [],
        importedCount: 0,
        invalidCount: 0,
        duplicateCount: 0,
        createdAt: now,
        updatedAt: now
    };
}
export class QueueService {
    store;
    automation;
    profiles;
    state = initialQueueState();
    loopPromise;
    queueDir;
    tasksDir;
    stateFile;
    productImagesDir;
    outputDir;
    productProfileFile;
    keepAwake;
    importUrls;
    constructor(store, automation, profiles, options = {}) {
        this.store = store;
        this.automation = automation;
        this.profiles = profiles;
        this.queueDir = options.queueDir ?? PRODUCT_QUEUE_DIR;
        this.tasksDir = options.tasksDir ?? PRODUCT_QUEUE_TASKS_DIR;
        this.stateFile = options.stateFile ?? PRODUCT_QUEUE_STATE_FILE;
        this.productImagesDir = options.productImagesDir ?? PRODUCT_IMAGES_DIR;
        this.outputDir = options.outputDir ?? OUTPUT_DIR;
        this.productProfileFile =
            options.productProfileFile ?? PRODUCT_PROFILE_FILE;
        this.keepAwake = options.keepAwake ?? ((task) => task());
        this.importUrls = options.importUrls ?? importImageUrlsToDirectory;
    }
    async load() {
        await Promise.all([
            mkdir(this.queueDir, { recursive: true }),
            mkdir(this.tasksDir, { recursive: true })
        ]);
        try {
            const loaded = JSON.parse(await readFile(this.stateFile, "utf8"));
            this.state = {
                ...initialQueueState(),
                ...loaded,
                tasks: loaded.tasks ?? [],
                pauseRequested: false,
                status: loaded.status === "running" || loaded.status === "preparing"
                    ? "paused"
                    : loaded.status,
                error: loaded.status === "running" || loaded.status === "preparing"
                    ? "检测到队列运行期间服务中断，请点击修复并继续"
                    : loaded.error,
                updatedAt: new Date().toISOString()
            };
            const current = this.currentTask();
            if (current?.status === "running")
                current.status = "paused";
        }
        catch {
            this.state = initialQueueState();
        }
        await this.save();
        return this.get();
    }
    get() {
        return structuredClone(this.state);
    }
    isLocked() {
        return (this.state.status === "running" ||
            this.state.status === "preparing" ||
            Boolean(this.state.currentTaskId));
    }
    async importWorkbook(fileName, buffer) {
        if (this.state.status === "running" ||
            this.state.status === "preparing" ||
            this.state.currentTaskId) {
            throw new Error("队列正在运行或等待恢复当前商品，不能导入新 Excel");
        }
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName)
            throw new Error("Excel 中没有工作表");
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: "" });
        if (rows.length > MAX_QUEUE_ROWS) {
            throw new Error(`单次最多导入 ${MAX_QUEUE_ROWS} 个商品`);
        }
        const headers = new Set(Object.keys(rows[0] ?? {}).map((key) => key.trim().toLowerCase()));
        if (!headers.has("image_url_1")) {
            throw new Error("Excel 缺少必填列 image_url_1");
        }
        this.state.status = "preparing";
        this.state.sourceExcelFile = path.basename(fileName);
        this.state.error = undefined;
        this.state.updatedAt = new Date().toISOString();
        await this.save();
        let imported = 0;
        let invalid = 0;
        let duplicates = 0;
        const existingFingerprints = new Set(this.state.tasks.map((task) => task.fingerprint));
        try {
            for (let index = 0; index < rows.length; index += 1) {
                let row;
                try {
                    row = this.normalizeRow(rows[index]);
                }
                catch (error) {
                    const sourceExcelRow = index + 2;
                    const task = {
                        taskId: randomUUID(),
                        fingerprint: createHash("sha256")
                            .update(`${fileName}:${sourceExcelRow}:${JSON.stringify(rows[index])}`)
                            .digest("hex"),
                        sourceExcelFile: path.basename(fileName),
                        sourceExcelRow,
                        productName: String(rows[index].product_name ?? "").trim() ||
                            `Excel 第 ${sourceExcelRow} 行商品`,
                        notes: String(rows[index].notes ?? "").trim(),
                        imageUrls: [],
                        imageNames: [],
                        status: "invalid",
                        error: error instanceof Error ? error.message : String(error),
                        createdAt: new Date().toISOString()
                    };
                    this.state.tasks.push(task);
                    invalid += 1;
                    await this.saveTask(task);
                    await this.save();
                    continue;
                }
                if (!row.productName && row.imageUrls.length === 0 && !row.notes) {
                    continue;
                }
                const sourceExcelRow = index + 2;
                const fingerprint = this.fingerprint(row.productName, row.imageUrls);
                if (existingFingerprints.has(fingerprint)) {
                    duplicates += 1;
                    continue;
                }
                existingFingerprints.add(fingerprint);
                const taskId = randomUUID();
                const task = {
                    taskId,
                    fingerprint,
                    sourceExcelFile: path.basename(fileName),
                    sourceExcelRow,
                    productName: row.productName || `Excel 第 ${sourceExcelRow} 行商品`,
                    notes: row.notes,
                    imageUrls: row.imageUrls,
                    imageNames: [],
                    status: "preparing",
                    createdAt: new Date().toISOString()
                };
                this.state.tasks.push(task);
                await this.saveTask(task);
                await this.save();
                if (row.imageUrls.length === 0) {
                    task.status = "invalid";
                    task.error = "至少需要一个图片 URL";
                    invalid += 1;
                    await this.saveTask(task);
                    continue;
                }
                const imageDirectory = this.taskImagesDir(taskId);
                try {
                    const result = await this.importUrls(imageDirectory, row.imageUrls, row.imageUrls.map((_, imageIndex) => `image-${imageIndex + 1}`));
                    const images = await scanImages(imageDirectory);
                    task.imageNames = images.map((image) => image.name);
                    if (result.rejected.length || images.length === 0) {
                        task.status = "invalid";
                        task.failedUrls = result.rejected.map((url) => ({
                            url,
                            error: "图片下载、格式或网络安全校验失败"
                        }));
                        task.error =
                            images.length === 0
                                ? "没有成功下载任何有效图片"
                                : `${result.rejected.length} 个图片 URL 无法导入`;
                        invalid += 1;
                    }
                    else {
                        task.status = "ready";
                        imported += 1;
                    }
                }
                catch (error) {
                    task.status = "invalid";
                    task.failedUrls = row.imageUrls.map((url) => ({
                        url,
                        error: error instanceof Error ? error.message : String(error)
                    }));
                    task.error = `图片预处理失败：${error instanceof Error ? error.message : String(error)}`;
                    invalid += 1;
                }
                await this.saveTask(task);
                await this.save();
            }
        }
        finally {
            this.state.status = this.readyTasks().length ? "idle" : "completed";
            this.state.importedCount += imported;
            this.state.invalidCount += invalid;
            this.state.duplicateCount += duplicates;
            this.state.updatedAt = new Date().toISOString();
            await this.save();
        }
        return { imported, invalid, duplicates };
    }
    async start() {
        if (this.loopPromise)
            throw new Error("队列已经在运行");
        if (!this.readyTasks().length && !this.currentTask()) {
            throw new Error("没有可执行的队列商品");
        }
        const currentState = this.store.get();
        if (!this.state.currentTaskId &&
            (currentState.chatUrl ||
                currentState.completedPhase ||
                currentState.workflowMode !== "standard_listing")) {
            throw new Error("当前工作区已有商品，请先完成归档或清空后再启动队列");
        }
        this.state.status = "running";
        this.state.pauseRequested = false;
        this.state.provider = currentState.provider;
        this.state.startedAt ??= new Date().toISOString();
        this.state.error = undefined;
        await this.save();
        this.loopPromise = this.keepAwake(() => this.runLoop()).finally(() => {
            this.loopPromise = undefined;
        });
    }
    async pause() {
        if (this.state.status !== "running") {
            throw new Error("队列当前没有运行");
        }
        this.state.pauseRequested = true;
        this.state.status = "paused";
        this.state.error = "已请求暂停，将在当前商品安全结束或停止后生效";
        await this.save();
        return this.get();
    }
    async resume() {
        if (this.loopPromise)
            throw new Error("队列仍在处理当前商品");
        if (this.state.status !== "paused")
            throw new Error("队列当前不需要恢复");
        this.state.pauseRequested = false;
        this.state.status = "running";
        this.state.provider = this.store.get().provider;
        this.state.error = undefined;
        await this.save();
        this.loopPromise = this.keepAwake(() => this.runLoop()).finally(() => {
            this.loopPromise = undefined;
        });
    }
    async cancel(taskId) {
        const task = this.state.tasks.find((candidate) => candidate.taskId === taskId);
        if (!task)
            throw new Error("队列任务不存在");
        if (!["ready", "invalid"].includes(task.status)) {
            throw new Error("只能取消尚未开始的任务");
        }
        task.status = "cancelled";
        task.error = undefined;
        await this.saveTask(task);
        await this.save();
        return this.get();
    }
    async clearCompleted() {
        if (this.state.status === "running" || this.state.currentTaskId) {
            throw new Error("队列运行中，不能清理记录");
        }
        const removable = this.state.tasks.filter((task) => ["completed", "cancelled", "abandoned"].includes(task.status));
        await Promise.all(removable.map((task) => rm(this.taskDir(task.taskId), { recursive: true, force: true })));
        this.state.tasks = this.state.tasks.filter((task) => !["completed", "cancelled", "abandoned"].includes(task.status));
        this.state.status = this.readyTasks().length ? "idle" : "completed";
        this.state.updatedAt = new Date().toISOString();
        await this.save();
        return this.get();
    }
    async abandonCurrent(continueQueue = true) {
        if (this.state.status !== "paused") {
            throw new Error("请先暂停队列，再遗弃当前商品");
        }
        if (this.loopPromise) {
            throw new Error("当前 AI 动作尚未安全停止，请稍后再遗弃");
        }
        const task = this.currentTask();
        if (!task)
            throw new Error("当前没有可遗弃的队列商品");
        const runState = this.store.get();
        if (runState.running || runState.autoRun) {
            throw new Error("当前 AI 动作尚未结束，请等待状态变为已暂停");
        }
        const abandonedDirectory = path.join(this.taskDir(task.taskId), "未完成结果");
        await rm(abandonedDirectory, { recursive: true, force: true });
        await mkdir(abandonedDirectory, { recursive: true });
        await cp(this.outputDir, path.join(abandonedDirectory, "output"), {
            recursive: true,
            force: true
        }).catch(() => undefined);
        await cp(this.productProfileFile, path.join(abandonedDirectory, "product-profile.json"), { force: true }).catch(() => undefined);
        await writeFile(path.join(abandonedDirectory, "run-state.json"), `${JSON.stringify(runState, null, 2)}\n`, "utf8");
        task.status = "abandoned";
        task.error = undefined;
        task.abandonedAt = new Date().toISOString();
        task.abandonedWorkspaceDirectory = path.relative(this.queueDir, abandonedDirectory);
        this.state.currentTaskId = undefined;
        this.state.pauseRequested = false;
        this.state.error = undefined;
        this.state.status = this.readyTasks().length ? "idle" : "completed";
        if (this.state.status === "completed") {
            this.state.completedAt = new Date().toISOString();
        }
        await this.saveTask(task);
        await this.clearCurrentWorkspace(`已遗弃 ${task.productName}，等待下一个商品`);
        await this.save();
        if (continueQueue && this.readyTasks().length) {
            await this.start();
        }
        return this.get();
    }
    templateBuffer() {
        const sheet = XLSX.utils.json_to_sheet([
            {
                product_name: "示例商品",
                image_url_1: "https://example.com/product-1.jpg",
                image_url_2: "https://example.com/product-2.jpg",
                notes: "可选内部备注"
            }
        ]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, "商品队列");
        return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    }
    async runLoop() {
        try {
            while (!this.state.pauseRequested) {
                let task = this.currentTask();
                if (!task) {
                    task = this.readyTasks()[0];
                    if (!task) {
                        this.state.status = "completed";
                        this.state.completedAt = new Date().toISOString();
                        this.state.error = undefined;
                        await this.save();
                        return;
                    }
                    await this.loadTask(task);
                }
                task.status = "running";
                task.startedAt ??= new Date().toISOString();
                this.state.currentTaskId = task.taskId;
                await this.saveTask(task);
                await this.save();
                await this.automation.runAll(() => !this.state.pauseRequested);
                const runState = this.store.get();
                if (this.state.pauseRequested) {
                    task.status = "paused";
                    task.error = undefined;
                    this.state.status = "paused";
                    this.state.error = "队列已暂停，可修复继续或遗弃当前商品";
                    await this.saveTask(task);
                    await this.save();
                    return;
                }
                if (runState.completedPhase !== "MVP5") {
                    task.status = "paused";
                    task.error = runState.error ?? "当前商品未完成，队列已暂停";
                    this.state.status = "paused";
                    this.state.error = task.error;
                    await this.saveTask(task);
                    await this.save();
                    return;
                }
                try {
                    await this.profiles.attachQueueSource({
                        queueTaskId: task.taskId,
                        sourceExcelFile: task.sourceExcelFile,
                        sourceExcelRow: task.sourceExcelRow
                    }, task.notes);
                }
                catch (error) {
                    await this.profiles.reportWarning("写入队列商品档案来源失败", error);
                }
                const archiveDirectory = await archiveCurrentProduct(runState);
                try {
                    await this.profiles.archiveCurrent(archiveDirectory);
                }
                catch (error) {
                    await this.profiles.reportWarning("归档队列商品档案失败", error);
                }
                task.status = "completed";
                task.archiveDirectory = archiveDirectory;
                task.completedAt = new Date().toISOString();
                task.error = undefined;
                this.state.currentTaskId = undefined;
                await this.saveTask(task);
                await this.store.reset("队列商品已归档，正在准备下一个商品");
                await this.save();
            }
        }
        catch (error) {
            const task = this.currentTask();
            if (task) {
                task.status = "paused";
                task.error = error instanceof Error ? error.message : String(error);
                await this.saveTask(task).catch(() => undefined);
            }
            this.state.status = "paused";
            this.state.error = error instanceof Error ? error.message : String(error);
            await this.save();
        }
    }
    async loadTask(task) {
        const provider = this.state.provider ?? this.store.get().provider;
        await Promise.all([
            rm(this.productImagesDir, { recursive: true, force: true }),
            rm(this.outputDir, { recursive: true, force: true }),
            rm(this.productProfileFile, { force: true })
        ]);
        await Promise.all([
            mkdir(this.productImagesDir, { recursive: true }),
            mkdir(this.outputDir, { recursive: true })
        ]);
        const images = await scanImages(this.taskImagesDir(task.taskId));
        if (!images.length)
            throw new Error(`${task.productName} 没有可用产品图片`);
        await Promise.all(images.map((image) => cp(image.path, path.join(this.productImagesDir, image.name))));
        await this.store.reset(`队列已加载：${task.productName}`);
        await this.store.update({
            workflowMode: "standard_listing",
            standardWorkflowGoal: "full_listing",
            provider,
            imageCount: images.length,
            imageNames: images.map((image) => image.name),
            startedAt: new Date().toISOString(),
            message: `队列已加载 ${task.productName}，准备执行完整 Listing`
        });
    }
    async clearCurrentWorkspace(message) {
        await Promise.all([
            rm(this.productImagesDir, { recursive: true, force: true }),
            rm(this.outputDir, { recursive: true, force: true }),
            rm(this.productProfileFile, { force: true })
        ]);
        await Promise.all([
            mkdir(this.productImagesDir, { recursive: true }),
            mkdir(this.outputDir, { recursive: true })
        ]);
        await this.store.reset(message);
    }
    currentTask() {
        return this.state.tasks.find((task) => task.taskId === this.state.currentTaskId);
    }
    readyTasks() {
        return this.state.tasks.filter((task) => task.status === "ready");
    }
    normalizeRow(row) {
        const normalized = new Map(Object.entries(row).map(([key, value]) => [
            key.trim().toLowerCase(),
            String(value ?? "").trim()
        ]));
        const imageUrls = [];
        for (let index = 1; index <= 12; index += 1) {
            const value = normalized.get(`image_url_${index}`);
            if (value)
                imageUrls.push(this.normalizeUrl(value));
        }
        return {
            productName: normalized.get("product_name") ?? "",
            notes: normalized.get("notes") ?? "",
            imageUrls: [...new Set(imageUrls)]
        };
    }
    normalizeUrl(value) {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error(`不支持的图片 URL：${value}`);
        }
        url.hash = "";
        return url.toString();
    }
    fingerprint(productName, imageUrls) {
        return createHash("sha256")
            .update(JSON.stringify({
            productName: productName.trim().toLowerCase(),
            imageUrls: [...imageUrls].sort()
        }))
            .digest("hex");
    }
    taskDir(taskId) {
        return path.join(this.tasksDir, taskId);
    }
    taskImagesDir(taskId) {
        return path.join(this.taskDir(taskId), "产品图");
    }
    async saveTask(task) {
        const directory = this.taskDir(task.taskId);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "task.json"), `${JSON.stringify(task, null, 2)}\n`, "utf8");
    }
    async save() {
        this.state.updatedAt = new Date().toISOString();
        await mkdir(path.dirname(this.stateFile), { recursive: true });
        const temporary = `${this.stateFile}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
        await rename(temporary, this.stateFile);
    }
}
//# sourceMappingURL=queue-service.js.map