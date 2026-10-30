/**
 * 图片资源隔离守卫（Phase 1 / F. 风格参考图与产品事实图隔离）
 *
 * 为什么需要它：
 *   一跨已经有物理隔离——产品事实图在 `当前产品/产品图/`，风格参考图在
 *   `当前产品/风格参考图/`，`scanProductImages()` 只读前者。物理隔离是对的，
 *   但它防不住"人手动把风格图复制进 产品图/"或"新代码写错目录"。
 *
 *   这个模块提供**第二道逻辑守卫**：用内容哈希比对两个目录，
 *   一旦出现同一份字节同时存在于两边，立即报出，而不是等到生图时才发现货不对版。
 *
 * 只读：不删除、不移动、不修改任何文件。
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PRODUCT_IMAGES_DIR, PRODUCT_STYLE_REF_DIR } from "./config.js";
import { isSupportedImage } from "./image-files.js";

async function hashDirectory(directory) {
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        // 只取直接子文件：子目录（如 .reset 备份）不参与，避免误报
        if (!entry.isFile() || !isSupportedImage(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        const content = await readFile(fullPath);
        files.push({
            name: entry.name,
            path: fullPath,
            size: content.length,
            sha256: createHash("sha256").update(content).digest("hex")
        });
    }
    return files;
}

/**
 * 审计两个目录是否存在内容重叠。
 * @returns {Promise<{ok:boolean, productImages:number, styleImages:number, overlappingHashes:Array}>}
 */
export async function auditImageIsolation(options = {}) {
    const productDir = options.productImagesDir ?? PRODUCT_IMAGES_DIR;
    const styleDir = options.styleReferenceDir ?? PRODUCT_STYLE_REF_DIR;

    const [productFiles, styleFiles] = await Promise.all([hashDirectory(productDir), hashDirectory(styleDir)]);
    const productHashes = new Map(productFiles.map((file) => [file.sha256, file.name]));
    const overlapping = [];
    for (const file of styleFiles) {
        if (productHashes.has(file.sha256)) {
            overlapping.push({
                hash: file.sha256,
                productImageName: productHashes.get(file.sha256),
                styleImageName: file.name,
                severity: "P0",
                message: "同一份图片同时存在于 产品图/ 和 风格参考图/：会被 scanProductImages 当作产品事实图"
            });
        }
    }
    return {
        ok: overlapping.length === 0,
        productImages: productFiles.length,
        styleImages: styleFiles.length,
        overlappingHashes: overlapping
    };
}

/**
 * 断言风格参考图目录与产品事实图目录不重叠。
 * 隔离被破坏时抛错，供启动自检与测试使用。
 */
export async function assertStyleReferenceIsolation(options = {}) {
    const audit = await auditImageIsolation(options);
    if (!audit.ok) {
        const detail = audit.overlappingHashes
            .map((entry) => `${entry.styleImageName} ↔ ${entry.productImageName}`)
            .join("；");
        throw new Error(`风格参考图与产品事实图隔离被破坏（${audit.overlappingHashes.length} 处重叠）：${detail}`);
    }
    return audit;
}
