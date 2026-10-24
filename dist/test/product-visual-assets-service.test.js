import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ProductVisualAssetsService } from "../src/product-visual-assets-service.js";
const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
async function tempService() {
    const root = await mkdtemp(path.join(os.tmpdir(), "visual-assets-"));
    const sourceDir = path.join(root, "source");
    await mkdir(sourceDir, { recursive: true });
    const sourcePath = path.join(sourceDir, "front.png");
    await writeFile(sourcePath, png1x1);
    const sha256 = createHash("sha256").update(png1x1).digest("hex");
    const profileFile = path.join(root, "product-profile.json");
    await writeFile(profileFile, JSON.stringify({ productId: "product-1" }));
    const service = new ProductVisualAssetsService({
        visualAssetsFile: path.join(root, "data", "product-visual-assets.json"),
        visualAssetsDir: path.join(root, "data", "product-visual-assets"),
        generationLogFile: path.join(root, "data", "image-generation-log.jsonl"),
        productProfileFile: profileFile,
        scanProductImages: async () => [
            {
                path: sourcePath,
                name: "front.png",
                size: png1x1.length,
                sha256
            }
        ]
    });
    return { root, service };
}
describe("product visual assets service", () => {
    it("builds stable source image assets and generation payloads", async () => {
        const { root, service } = await tempService();
        try {
            const assets = await service.rebuildCurrentReferenceSet("product-1");
            assert.equal(assets.product_id, "product-1");
            assert.equal(assets.source_images.length, 1);
            assert.equal(assets.source_images[0].role, "front");
            assert.ok(assets.source_images[0].storage_path.includes("product-visual-assets"));
            const payload = await service.validateGenerationInput({
                product_id: "product-1",
                image_number: 1,
                image_prompt: "single product hero image"
            });
            assert.equal(payload.image_number, "01");
            assert.deepEqual(payload.reference_image_asset_ids, [assets.source_images[0].asset_id]);
            assert.deepEqual(payload.reference_image_hashes, [assets.source_images[0].sha256]);
            assert.equal(payload.reference_image_paths.length, 1);
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("blocks generation when the bound source image is missing", async () => {
        const { root, service } = await tempService();
        try {
            const assets = await service.rebuildCurrentReferenceSet("product-1");
            await unlink(assets.source_images[0].storage_path);
            await assert.rejects(() => service.validateGenerationInput({
                product_id: "product-1",
                image_number: 1,
                image_prompt: "single product hero image"
            }), /缺少可用产品源图/);
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("falls back to product-facts identity when the legacy product profile is absent", async () => {
        const { root, service } = await tempService();
        try {
            const factsFile = path.join(root, "product-facts.json");
            await writeFile(factsFile, JSON.stringify({ productId: "facts-product-1" }));
            service.paths.productFactsFile = factsFile;
            await unlink(service.paths.productProfileFile);
            assert.equal(await service.currentProductId(), "facts-product-1");
            const payload = await service.validateGenerationInput({
                image_number: 1,
                image_prompt: "single product hero image"
            });
            assert.equal(payload.product_id, "facts-product-1");
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("limits each image generation to three prioritized identity references", async () => {
        const { root, service } = await tempService();
        try {
            const sourceDir = path.join(root, "source");
            const names = ["front.png", "side.png", "back.png", "detail.png"];
            const images = await Promise.all(names.map(async (name, index) => {
                const buffer = Buffer.concat([png1x1, Buffer.from([index])]);
                const sourcePath = path.join(sourceDir, name);
                await writeFile(sourcePath, buffer);
                return {
                    path: sourcePath,
                    name,
                    size: buffer.length,
                    sha256: createHash("sha256").update(buffer).digest("hex")
                };
            }));
            service.paths.scanProductImages = async () => images;
            const assets = await service.rebuildCurrentReferenceSet("product-1");
            const payload = await service.validateGenerationInput({
                product_id: "product-1",
                image_number: 1,
                image_prompt: "single product hero image"
            });
            assert.equal(payload.reference_image_paths.length, 3);
            assert.deepEqual(payload.reference_image_asset_ids, assets.source_images.slice(0, 3).map((image) => image.asset_id));
            assert.match(payload.warnings.join("\n"), /3\/4/);
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    it("writes traceable image generation log records", async () => {
        const { root, service } = await tempService();
        try {
            await service.logGeneration({
                product_id: "product-1",
                image_number: "01",
                prompt_version: "single-image-v1",
                reference_image_asset_ids: ["asset-a"],
                reference_image_hashes: ["hash-a"],
                active_reference_set_id: "vrs-a",
                status: "queued"
            });
            const log = await readFile(path.join(root, "data", "image-generation-log.jsonl"), "utf8");
            assert.match(log, /"product_id":"product-1"/);
            assert.match(log, /"reference_image_asset_ids":\["asset-a"\]/);
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=product-visual-assets-service.test.js.map
