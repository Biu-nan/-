import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ProductProfileService } from "../src/product-profile-service.js";
const schemaFile = path.join(process.cwd(), "schemas", "product-profile.schema.json");
function identifiedState(patch = {}) {
    return {
        stage: "COMPLETED",
        message: "MVP 1 已完成",
        running: false,
        workflowMode: "standard_listing",
        standardWorkflowGoal: "full_listing",
        researchCompleted: false,
        browserStarted: true,
        provider: "chatgpt",
        chatUrl: "https://chatgpt.com/c/test",
        imageCount: 1,
        imageNames: ["product.png"],
        responseText: "Recommended Chinese Product Name: 测试收纳包\nRecommended Product Category: Organizer",
        completedPhase: "MVP1",
        updatedAt: new Date().toISOString(),
        ...patch
    };
}
async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), "product-profile-"));
    const productRoot = path.join(root, "当前产品");
    const completedProductsDir = path.join(root, "已完成产品");
    const profileFile = path.join(productRoot, "product-profile.json");
    await mkdir(path.join(productRoot, "产品图"), { recursive: true });
    await mkdir(completedProductsDir, { recursive: true });
    await writeFile(path.join(productRoot, "产品图", "product.png"), "image");
    const service = new ProductProfileService({
        productRoot,
        completedProductsDir,
        profileFile,
        schemaFile,
        logFile: path.join(root, "product-profile.log")
    });
    await service.initialize();
    return { root, productRoot, completedProductsDir, profileFile, service };
}
describe("product profile foundation", () => {
    it("creates one stable UUID after identification and preserves it across sync", async () => {
        const value = await fixture();
        try {
            await value.service.syncFromState(identifiedState());
            const first = await value.service.getCurrent();
            assert.equal(first.status, "normal");
            assert.match(first.profile.productId, /^[0-9a-f-]{36}$/i);
            await value.service.syncFromState(identifiedState({
                stage: "SENDING_RESEARCH",
                message: "research",
                running: true
            }));
            const second = await value.service.getCurrent();
            assert.equal(second.profile.productId, first.profile.productId);
            assert.equal(second.profile.lifecycle.currentStage, "SENDING_RESEARCH");
            await value.service.syncFromState(identifiedState({
                completedPhase: "MVP5",
                stage: "COMPLETED",
                message: "done"
            }));
            await value.service.syncFromState(identifiedState({
                startedAt: new Date(Date.now() + 60_000).toISOString(),
                responseText: "Recommended Chinese Product Name: 新商品\nRecommended Product Category: Bag"
            }));
            const nextProduct = await value.service.getCurrent();
            assert.notEqual(nextProduct.profile.productId, first.profile.productId);
            assert.equal(nextProduct.profile.identity.displayName, "新商品");
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
    it("keeps manual next-action override above the system suggestion", async () => {
        const value = await fixture();
        try {
            await value.service.syncFromState(identifiedState());
            const updated = await value.service.updateCurrent({
                manualOverride: "先确认供应商库存"
            });
            assert.equal(updated.nextAction.manualOverride?.source, "user");
            assert.equal(updated.nextAction.effective, "先确认供应商库存");
            await value.service.syncFromState(identifiedState({ researchCompleted: true }));
            const synced = await value.service.getCurrent();
            assert.equal(synced.profile.nextAction.effective, "先确认供应商库存");
            const reset = await value.service.resetManualOverride();
            assert.equal(reset.nextAction.manualOverride, undefined);
            assert.equal(reset.nextAction.effective, reset.nextAction.suggested);
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
    it("marks broken JSON, illegal stages and escaping artifact paths as invalid", async () => {
        const value = await fixture();
        try {
            const broken = path.join(value.completedProductsDir, "损坏 JSON");
            await mkdir(broken);
            await writeFile(path.join(broken, "product-profile.json"), "{bad");
            await value.service.syncFromState(identifiedState());
            const current = (await value.service.getCurrent()).profile;
            const illegalStage = structuredClone(current);
            illegalStage.lifecycle.currentStage = "FREE_TEXT_STAGE";
            const stageDirectory = path.join(value.completedProductsDir, "非法阶段");
            await mkdir(stageDirectory);
            await writeFile(path.join(stageDirectory, "product-profile.json"), JSON.stringify(illegalStage));
            const escapingPath = structuredClone(current);
            escapingPath.artifacts = [
                {
                    path: "../secret.txt",
                    type: "other",
                    size: 1,
                    updatedAt: new Date().toISOString()
                }
            ];
            const pathDirectory = path.join(value.completedProductsDir, "路径越界");
            await mkdir(pathDirectory);
            await writeFile(path.join(pathDirectory, "product-profile.json"), JSON.stringify(escapingPath));
            const library = await value.service.listLibrary();
            assert.equal(library.filter((entry) => entry.status === "invalid").length, 3);
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
    it("previews and creates one legacy archive without bulk rewriting others", async () => {
        const value = await fixture();
        try {
            const first = path.join(value.completedProductsDir, "历史商品一");
            const second = path.join(value.completedProductsDir, "历史商品二");
            await Promise.all([mkdir(first), mkdir(second)]);
            await writeFile(path.join(first, "run-state.json"), JSON.stringify(identifiedState()));
            await writeFile(path.join(first, "Image_01.png"), "image");
            const before = await value.service.listLibrary();
            assert.equal(before.filter((entry) => entry.status === "pending").length, 2);
            const preview = await value.service.previewLegacy("历史商品一");
            assert.equal(preview.displayName, "测试收纳包");
            await value.service.createLegacy("历史商品一");
            const after = await value.service.listLibrary();
            assert.equal(after.find((entry) => entry.directoryName === "历史商品一")?.status, "normal");
            assert.equal(after.find((entry) => entry.directoryName === "历史商品二")?.status, "pending");
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
    it("creates lightweight archived product profiles with source markers", async () => {
        const value = await fixture();
        try {
            const profile = await value.service.createLightweightArchived({
                displayName: "新开发商品",
                workflowMode: "standard_listing",
                category: "Organizer",
                notes: "库存驱动候选",
                sourceTag: "new_product_development"
            });
            const library = await value.service.listLibrary();
            const entry = library.find((item) => item.productId === profile.productId);
            assert.equal(entry?.status, "normal");
            assert.equal(entry?.displayName, "新开发商品");
            assert.match(entry?.notes ?? "", /\[source: new_product_development\]/);
            assert.equal(entry?.artifactCount, 0);
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
    it("archives the profile with relative file paths and unchanged productId", async () => {
        const value = await fixture();
        try {
            await value.service.syncFromState(identifiedState());
            const original = (await value.service.getCurrent()).profile;
            const destination = path.join(value.completedProductsDir, "测试收纳包");
            await mkdir(path.join(destination, "产品图"), { recursive: true });
            await writeFile(path.join(destination, "产品图", "product.png"), "image");
            await writeFile(path.join(destination, "run-state.json"), JSON.stringify(identifiedState()));
            await value.service.archiveCurrent(destination);
            const archived = JSON.parse(await readFile(path.join(destination, "product-profile.json"), "utf8"));
            assert.equal(archived.productId, original.productId);
            assert.equal(archived.lifecycle.status, "archived");
            assert.ok(archived.artifacts.every((artifact) => !path.isAbsolute(artifact.path)));
            assert.ok(archived.artifacts.every((artifact) => !artifact.path.includes("..")));
            assert.equal((await value.service.getCurrent()).status, "missing");
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
    it("turns profile write failures into warnings instead of throwing", async () => {
        const value = await fixture();
        try {
            const blocker = path.join(value.root, "blocked");
            await writeFile(blocker, "not a directory");
            const service = new ProductProfileService({
                productRoot: value.productRoot,
                completedProductsDir: value.completedProductsDir,
                profileFile: path.join(blocker, "product-profile.json"),
                schemaFile,
                logFile: path.join(value.root, "warnings.log")
            });
            await service.initialize();
            await assert.doesNotReject(() => service.syncFromState(identifiedState()));
            assert.match(service.getWarning() ?? "", /(同步商品档案失败|product-profile\.json 异常)/);
        }
        finally {
            await rm(value.root, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=product-profile.test.js.map