import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { IMAGE_GENERATION_LOG_FILE, PRODUCT_PROFILE_FILE, PRODUCT_VISUAL_ASSETS_DIR, PRODUCT_VISUAL_ASSETS_FILE } from "./config.js";
import { hashBuffer, scanProductImages } from "./image-files.js";
const ROLE_ORDER = ["front", "side", "back"];
function nowIso() {
    return new Date().toISOString();
}
function mimeTypeFor(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === ".png")
        return "image/png";
    if (ext === ".webp")
        return "image/webp";
    return "image/jpeg";
}
function imageDimensions(buffer) {
    if (buffer.length >= 24 &&
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return {
            width: buffer.readUInt32BE(16),
            height: buffer.readUInt32BE(20)
        };
    }
    if (buffer.length >= 10 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
        const chunk = buffer.subarray(12, 16).toString("ascii");
        if (chunk === "VP8X" && buffer.length >= 30) {
            return {
                width: 1 + buffer.readUIntLE(24, 3),
                height: 1 + buffer.readUIntLE(27, 3)
            };
        }
    }
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
        let offset = 2;
        while (offset + 9 < buffer.length) {
            if (buffer[offset] !== 0xff)
                break;
            const marker = buffer[offset + 1];
            const length = buffer.readUInt16BE(offset + 2);
            if (length < 2)
                break;
            if (marker >= 0xc0 && marker <= 0xc3) {
                return {
                    height: buffer.readUInt16BE(offset + 5),
                    width: buffer.readUInt16BE(offset + 7)
                };
            }
            offset += 2 + length;
        }
    }
    return { width: 0, height: 0 };
}
function stableSetId(productId, hashes) {
    const digest = createHash("sha256")
        .update(`${productId}:${hashes.join("|")}`)
        .digest("hex")
        .slice(0, 16);
    return `vrs_${digest}`;
}
async function readCurrentProductId(profileFile) {
    try {
        const raw = await readFile(profileFile, "utf8");
        const profile = JSON.parse(raw);
        return profile.productId;
    }
    catch {
        return undefined;
    }
}
export class ProductVisualAssetsService {
    paths;
    constructor(paths = {
        visualAssetsFile: PRODUCT_VISUAL_ASSETS_FILE,
        visualAssetsDir: PRODUCT_VISUAL_ASSETS_DIR,
        generationLogFile: IMAGE_GENERATION_LOG_FILE,
        productProfileFile: PRODUCT_PROFILE_FILE
    }) {
        this.paths = paths;
    }
    async scanImages() {
        return (this.paths.scanProductImages ?? scanProductImages)();
    }
    async currentProductId() {
        return readCurrentProductId(this.paths.productProfileFile);
    }
    async rebuildCurrentReferenceSet(productId = "current-product") {
        const images = await this.scanImages();
        const createdAt = nowIso();
        const hashes = images.map((image) => image.sha256);
        const referenceSetId = stableSetId(productId, hashes);
        const productDir = path.join(this.paths.visualAssetsDir, productId, referenceSetId);
        await mkdir(productDir, { recursive: true });
        const sourceImages = [];
        for (let index = 0; index < images.length; index += 1) {
            const image = images[index];
            const content = await readFile(image.path);
            const ext = path.extname(image.name).toLowerCase() || ".jpg";
            const assetId = `asset_${image.sha256.slice(0, 16)}`;
            const storagePath = path.join(productDir, `${assetId}${ext}`);
            await copyFile(image.path, storagePath);
            sourceImages.push({
                asset_id: assetId,
                role: ROLE_ORDER[index] ?? (index === 3 ? "detail" : "unknown"),
                original_filename: image.name,
                storage_path: storagePath,
                mime_type: mimeTypeFor(image.name),
                ...imageDimensions(content),
                sha256: image.sha256,
                created_at: createdAt,
                is_active_reference: true
            });
        }
        const assets = {
            product_id: productId,
            visual_reference_set_id: referenceSetId,
            source_images: sourceImages,
            active_reference_set_id: referenceSetId,
            identity_lock_version: `identity_${referenceSetId}`,
            updated_at: createdAt
        };
        const store = await this.readStore();
        store.products[productId] = assets;
        await this.writeStore(store);
        return assets;
    }
    async getCurrentReferenceSet(productId) {
        const resolvedProductId = productId ?? (await this.currentProductId());
        if (!resolvedProductId)
            return undefined;
        const store = await this.readStore();
        return store.products[resolvedProductId];
    }
    async ensureCurrentReferenceSet(productId) {
        const resolvedProductId = productId ?? (await this.currentProductId()) ?? "current-product";
        const existing = await this.getCurrentReferenceSet(resolvedProductId);
        const currentImages = await this.scanImages();
        const currentHashes = currentImages.map((image) => image.sha256).join("|");
        const existingHashes = existing?.source_images.map((image) => image.sha256).join("|");
        if (existing && currentHashes === existingHashes)
            return existing;
        return this.rebuildCurrentReferenceSet(resolvedProductId);
    }
    async validateGenerationInput(input) {
        const productId = input.product_id ?? (await this.currentProductId());
        if (!productId)
            throw new Error("缺少 product_id，无法绑定产品源图");
        if (!Number.isInteger(input.image_number) || input.image_number < 1 || input.image_number > 10) {
            throw new Error("image_number 必须是 01–10 中的一张图");
        }
        if (!input.image_prompt.trim())
            throw new Error("缺少 Image Prompt，不能生成图片");
        const assets = await this.ensureCurrentReferenceSet(productId);
        if (assets.product_id !== productId) {
            throw new Error("当前产品源图绑定与 product_id 不一致，请重新绑定产品参考图");
        }
        if (!assets.active_reference_set_id)
            throw new Error("缺少 active_reference_set_id，请重新绑定产品参考图");
        const activeImages = assets.source_images.filter((image) => image.is_active_reference);
        if (activeImages.length === 0)
            throw new Error("缺少产品源图，请重新上传或重新绑定产品参考图");
        const warnings = [];
        const front = activeImages.find((image) => image.role === "front");
        if (!front)
            warnings.push("未标记 front 图，已使用第一张 active source image 作为主参考图");
        for (const image of activeImages) {
            const file = await readFile(image.storage_path).catch(() => undefined);
            if (!file)
                throw new Error(`缺少可用产品源图：${image.original_filename}`);
            await stat(image.storage_path).catch(() => {
                throw new Error(`产品源图不可读：${image.original_filename}`);
            });
            const actualHash = hashBuffer(file);
            if (actualHash !== image.sha256) {
                throw new Error(`产品源图 hash 校验失败：${image.original_filename}`);
            }
        }
        return {
            product_id: productId,
            image_number: String(input.image_number).padStart(2, "0"),
            prompt_version: input.prompt_version ?? "v1",
            image_prompt: input.image_prompt,
            reference_image_asset_ids: activeImages.map((image) => image.asset_id),
            reference_image_paths: activeImages.map((image) => image.storage_path),
            reference_image_hashes: activeImages.map((image) => image.sha256),
            active_reference_set_id: assets.active_reference_set_id,
            identity_lock_version: assets.identity_lock_version,
            warnings
        };
    }
    async logGeneration(record) {
        await mkdir(path.dirname(this.paths.generationLogFile), { recursive: true });
        const line = JSON.stringify({
            generation_id: record.generation_id ?? randomUUID(),
            created_at: nowIso(),
            ...record
        });
        await writeFile(this.paths.generationLogFile, `${line}\n`, { flag: "a" });
    }
    async findAsset(assetId) {
        const store = await this.readStore();
        for (const product of Object.values(store.products)) {
            const asset = product.source_images.find((image) => image.asset_id === assetId);
            if (asset)
                return asset;
        }
        return undefined;
    }
    async readStore() {
        try {
            return JSON.parse(await readFile(this.paths.visualAssetsFile, "utf8"));
        }
        catch {
            return { schema_version: "1.0", products: {} };
        }
    }
    async writeStore(store) {
        await mkdir(path.dirname(this.paths.visualAssetsFile), { recursive: true });
        await writeFile(this.paths.visualAssetsFile, `${JSON.stringify(store, null, 2)}\n`);
    }
}
//# sourceMappingURL=product-visual-assets-service.js.map