import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { QueueService } from "../src/queue-service.js";
function workbookBuffer(rows) {
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "商品队列");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), "queue-service-"));
    const queueDir = path.join(root, "商品队列");
    const tasksDir = path.join(queueDir, "tasks");
    const productImagesDir = path.join(root, "当前产品", "产品图");
    const outputDir = path.join(root, "当前产品", "output");
    const profileFile = path.join(root, "当前产品", "product-profile.json");
    const importUrls = async (directory, urls) => {
        await mkdir(directory, { recursive: true });
        const result = {
            imported: [],
            skippedDuplicates: [],
            rejected: []
        };
        for (let index = 0; index < urls.length; index += 1) {
            const url = urls[index];
            if (url.includes("invalid")) {
                result.rejected.push(url);
                continue;
            }
            const name = `image-${index + 1}.png`;
            await writeFile(path.join(directory, name), `image-${url}`);
            result.imported.push(name);
        }
        return result;
    };
    const store = {
        get: () => ({
            stage: "IDLE",
            message: "",
            running: false,
            workflowMode: "standard_listing",
            standardWorkflowGoal: "full_listing",
            browserStarted: false,
            provider: "chatgpt",
            imageCount: 0,
            imageNames: [],
            updatedAt: new Date().toISOString()
        })
    };
    const service = new QueueService(store, {}, {}, {
        queueDir,
        tasksDir,
        stateFile: path.join(queueDir, "queue-state.json"),
        productImagesDir,
        outputDir,
        productProfileFile: profileFile,
        importUrls
    });
    await service.load();
    return { root, queueDir, service };
}
describe("Excel product queue", () => {
    it("imports valid rows in Excel order and isolates invalid image rows", async () => {
        const value = await fixture();
        try {
            const summary = await value.service.importWorkbook("products.xlsx", workbookBuffer([
                {
                    product_name: "商品 A",
                    image_url_1: "https://example.com/a.png",
                    image_url_2: "https://example.com/a-2.png"
                },
                {
                    product_name: "商品 B",
                    image_url_1: "https://example.com/invalid.png"
                },
                {
                    product_name: "商品 C",
                    image_url_1: "https://example.com/c.png"
                }
            ]));
            assert.deepEqual(summary, { imported: 2, invalid: 1, duplicates: 0 });
            const queue = value.service.get();
            assert.deepEqual(queue.tasks.map((task) => [task.productName, task.status]), [
                ["商品 A", "ready"],
                ["商品 B", "invalid"],
                ["商品 C", "ready"]
            ]);
            assert.deepEqual(queue.tasks.map((task) => task.sourceExcelRow), [2, 3, 4]);
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
    it("marks an importer exception invalid and continues with later rows", async () => {
        const value = await fixture();
        try {
            const service = new QueueService({
                get: () => ({
                    stage: "IDLE",
                    message: "",
                    running: false,
                    workflowMode: "standard_listing",
                    standardWorkflowGoal: "full_listing",
                    browserStarted: false,
                    provider: "chatgpt",
                    imageCount: 0,
                    imageNames: [],
                    updatedAt: new Date().toISOString()
                })
            }, {}, {}, {
                queueDir: value.queueDir,
                tasksDir: path.join(value.queueDir, "tasks"),
                stateFile: path.join(value.queueDir, "queue-state.json"),
                productImagesDir: path.join(value.root, "当前产品", "产品图"),
                outputDir: path.join(value.root, "当前产品", "output"),
                productProfileFile: path.join(value.root, "当前产品", "product-profile.json"),
                importUrls: async (directory, urls) => {
                    if (urls[0].includes("throws"))
                        throw new Error("下载连接中断");
                    await mkdir(directory, { recursive: true });
                    await writeFile(path.join(directory, "image-1.png"), "image");
                    return {
                        imported: ["image-1.png"],
                        skippedDuplicates: [],
                        rejected: []
                    };
                }
            });
            await service.load();
            const summary = await service.importWorkbook("products.xlsx", workbookBuffer([
                {
                    product_name: "异常商品",
                    image_url_1: "https://example.com/throws.png"
                },
                {
                    product_name: "正常商品",
                    image_url_1: "https://example.com/ok.png"
                }
            ]));
            assert.deepEqual(summary, { imported: 1, invalid: 1, duplicates: 0 });
            assert.deepEqual(service.get().tasks.map((task) => [task.productName, task.status]), [
                ["异常商品", "invalid"],
                ["正常商品", "ready"]
            ]);
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
    it("skips duplicate row fingerprints across repeated imports", async () => {
        const value = await fixture();
        try {
            const buffer = workbookBuffer([
                {
                    product_name: "商品 A",
                    image_url_1: "https://example.com/a.png"
                }
            ]);
            await value.service.importWorkbook("first.xlsx", buffer);
            const second = await value.service.importWorkbook("second.xlsx", buffer);
            assert.deepEqual(second, { imported: 0, invalid: 0, duplicates: 1 });
            assert.equal(value.service.get().tasks.length, 1);
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
    it("persists cancelled tasks and restores an interrupted queue as paused", async () => {
        const value = await fixture();
        try {
            await value.service.importWorkbook("products.xlsx", workbookBuffer([
                {
                    product_name: "商品 A",
                    image_url_1: "https://example.com/a.png"
                }
            ]));
            const taskId = value.service.get().tasks[0].taskId;
            await value.service.cancel(taskId);
            assert.equal(value.service.get().tasks[0].status, "cancelled");
            const statePath = path.join(value.queueDir, "queue-state.json");
            const state = JSON.parse(await readFile(statePath, "utf8"));
            state.status = "running";
            state.currentTaskId = taskId;
            state.tasks[0].status = "running";
            await writeFile(statePath, JSON.stringify(state));
            const restored = await fixtureFromExisting(value.root);
            const loaded = await restored.load();
            assert.equal(loaded.status, "paused");
            assert.equal(loaded.tasks[0].status, "paused");
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
    it("abandons a paused current product, preserves its snapshot and clears the workspace", async () => {
        const value = await fixture();
        try {
            await value.service.importWorkbook("products.xlsx", workbookBuffer([
                {
                    product_name: "准备遗弃的商品",
                    image_url_1: "https://example.com/a.png"
                },
                {
                    product_name: "下一个商品",
                    image_url_1: "https://example.com/b.png"
                }
            ]));
            const statePath = path.join(value.queueDir, "queue-state.json");
            const persisted = JSON.parse(await readFile(statePath, "utf8"));
            const currentTaskId = persisted.tasks[0].taskId;
            persisted.status = "paused";
            persisted.currentTaskId = currentTaskId;
            persisted.tasks[0].status = "paused";
            await writeFile(statePath, JSON.stringify(persisted));
            const productRoot = path.join(value.root, "当前产品");
            const productImagesDir = path.join(productRoot, "产品图");
            const outputDir = path.join(productRoot, "output");
            const profileFile = path.join(productRoot, "product-profile.json");
            await mkdir(productImagesDir, { recursive: true });
            await mkdir(outputDir, { recursive: true });
            await writeFile(path.join(productImagesDir, "current.png"), "current");
            await writeFile(path.join(outputDir, "Image_01.png"), "generated");
            await writeFile(profileFile, "{}");
            let runState = {
                stage: "PAUSED",
                message: "已暂停",
                running: false,
                autoRun: false,
                workflowMode: "standard_listing",
                standardWorkflowGoal: "full_listing",
                browserStarted: false,
                provider: "chatgpt",
                imageCount: 1,
                imageNames: ["current.png"],
                generatedImageNumbers: [1],
                updatedAt: new Date().toISOString()
            };
            const store = {
                get: () => structuredClone(runState),
                reset: async (message) => {
                    runState = {
                        ...runState,
                        stage: "IDLE",
                        message,
                        running: false,
                        autoRun: false,
                        imageCount: 0,
                        imageNames: [],
                        generatedImageNumbers: [],
                        updatedAt: new Date().toISOString()
                    };
                    return structuredClone(runState);
                }
            };
            const service = new QueueService(store, {}, {}, {
                queueDir: value.queueDir,
                tasksDir: path.join(value.queueDir, "tasks"),
                stateFile: statePath,
                productImagesDir,
                outputDir,
                productProfileFile: profileFile
            });
            await service.load();
            const queue = await service.abandonCurrent(false);
            assert.equal(queue.currentTaskId, undefined);
            assert.equal(queue.status, "idle");
            assert.equal(queue.tasks[0].status, "abandoned");
            assert.equal(queue.tasks[1].status, "ready");
            assert.ok(queue.tasks[0].abandonedAt);
            assert.ok(queue.tasks[0].abandonedWorkspaceDirectory);
            const abandonedRoot = path.join(value.queueDir, queue.tasks[0].abandonedWorkspaceDirectory);
            assert.equal(JSON.parse(await readFile(path.join(abandonedRoot, "run-state.json"), "utf8")).stage, "PAUSED");
            assert.equal(await readFile(path.join(abandonedRoot, "output", "Image_01.png"), "utf8"), "generated");
            assert.deepEqual(await readFile(profileFile, "utf8").catch(() => ""), "");
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
    it("produces an XLSX template with the required columns", async () => {
        const value = await fixture();
        try {
            const workbook = XLSX.read(value.service.templateBuffer(), {
                type: "buffer"
            });
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            assert.ok("product_name" in rows[0]);
            assert.ok("image_url_1" in rows[0]);
            assert.ok("notes" in rows[0]);
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
});
async function fixtureFromExisting(root) {
    return new QueueService({}, {}, {}, {
        queueDir: path.join(root, "商品队列"),
        tasksDir: path.join(root, "商品队列", "tasks"),
        stateFile: path.join(root, "商品队列", "queue-state.json"),
        productImagesDir: path.join(root, "当前产品", "产品图"),
        outputDir: path.join(root, "当前产品", "output"),
        productProfileFile: path.join(root, "当前产品", "product-profile.json")
    });
}
//# sourceMappingURL=queue-service.test.js.map