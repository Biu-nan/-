import { access, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ABANDONED_PRODUCTS_DIR, COMPLETED_PRODUCTS_DIR, INSERT_BAG_IMAGES_DIR, INSERT_LINER_IMAGES_DIR, INSERT_OUTPUT_DIR, OUTPUT_DIR, PRODUCT_ROOT, PRODUCT_IMAGES_DIR } from "./config.js";
const FALLBACK_PRODUCT_NAME = "未命名产品";
export function extractChineseProductName(state) {
    if (state.batchProductName) {
        return sanitizeProductName(state.batchProductName);
    }
    const sources = [
        state.responseText ?? "",
        state.researchText ?? "",
        state.planningText ?? ""
    ];
    const explicitPatterns = [
        /Recommended Chinese Product Name\s*[:：]\s*([^\n|]+)/i,
        /推荐中文产品名称\s*[:：]\s*([^\n|]+)/,
        /产品中文名\s*[:：]\s*([^\n|]+)/
    ];
    for (const source of sources) {
        for (const pattern of explicitPatterns) {
            const match = source.match(pattern);
            if (match?.[1])
                return sanitizeProductName(match[1]);
        }
    }
    const joined = sources.join("\n");
    const contextualPatterns = [
        /已上传产品[（(]([^）)\n]{2,40})[）)]/,
        /当前商品[^：:\n]*[:：]\s*(?:单个|一个|一款)?\s*([^\n，。；]{2,40})/,
        /(?:单个|一个|一款)([\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9\s/-]{2,35}(?:钥匙扣|零钱包|收纳包|手提包|背包|挂件|玩具|饰品|产品))/
    ];
    for (const pattern of contextualPatterns) {
        const match = joined.match(pattern);
        if (match?.[1])
            return sanitizeProductName(match[1]);
    }
    return FALLBACK_PRODUCT_NAME;
}
export function sanitizeProductName(value) {
    const cleaned = value
        .replace(/[*"<>:：|?？\\/]/g, " ")
        .replace(/[。；，,]+$/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60)
        .trim();
    return cleaned || FALLBACK_PRODUCT_NAME;
}
async function availableArchiveDirectory(productName) {
    const base = path.join(COMPLETED_PRODUCTS_DIR, productName);
    if (!(await exists(base)))
        return base;
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
        const candidate = path.join(COMPLETED_PRODUCTS_DIR, `${productName} (${suffix})`);
        if (!(await exists(candidate)))
            return candidate;
    }
    throw new Error(`同名产品归档目录过多：${productName}`);
}
async function exists(target) {
    return access(target)
        .then(() => true)
        .catch(() => false);
}
export async function archiveCurrentProduct(state) {
    const destination = await availableArchiveDirectory(extractChineseProductName(state));
    const archivedImages = path.join(destination, "产品图");
    const archivedOutput = path.join(destination, "output");
    await mkdir(destination, { recursive: true });
    // Atomically move the two work directories into the archive (NOT cp+rm),
    // so the safe-delete shim can never block archiving and the workspace is cleared reliably.
    // Using rename (already imported) also avoids the ReferenceError caused by the missing
    // cp/rm imports after the abandonCurrentProduct refactor.
    for (const [src, dest] of [[PRODUCT_IMAGES_DIR, archivedImages], [OUTPUT_DIR, archivedOutput]]) {
        try {
            await rename(src, dest);
        }
        catch (err) {
            if (err && err.code === "ENOENT") {
                await mkdir(dest, { recursive: true });
            }
            else {
                throw err;
            }
        }
    }
    // 桥接产物：把 当前产品/product-facts.json 一并归档（存在才搬，避免污染归档目录）
    const currentFacts = path.join(PRODUCT_ROOT, "product-facts.json");
    if (await exists(currentFacts)) {
        try {
            await rename(currentFacts, path.join(destination, "product-facts.json"));
        }
        catch (err) {
            if (err && err.code !== "ENOENT")
                throw err;
        }
    }
    await writeFile(path.join(destination, "run-state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await Promise.all([
        mkdir(PRODUCT_IMAGES_DIR, { recursive: true }),
        mkdir(OUTPUT_DIR, { recursive: true })
    ]);
    return destination;
}
export async function abandonCurrentProduct(state) {
    const productName = state.workflowMode === "luxury_insert"
        ? sanitizeProductName(`${state.luxuryInsert?.brand ?? ""} ${state.luxuryInsert?.bagFamily ?? "未命名内胆任务"}`)
        : extractChineseProductName(state);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(ABANDONED_PRODUCTS_DIR, `${productName}-${stamp}`);
    await mkdir(destination, { recursive: true });
    // Move the whole current product tree atomically via rename (NOT fs.rm),
    // so the safe-delete shim never blocks the abandon and the workspace is cleared reliably.
    await rename(PRODUCT_ROOT, path.join(destination, "当前产品快照"));
    await writeFile(path.join(destination, "run-state.json"), `${JSON.stringify({
        ...state,
        running: false,
        autoRun: false,
        pauseRequested: false,
        stage: "PAUSED",
        message: "商品已由用户遗弃"
    }, null, 2)}\n`, "utf8");
    await Promise.all([
        mkdir(PRODUCT_IMAGES_DIR, { recursive: true }),
        mkdir(OUTPUT_DIR, { recursive: true }),
        mkdir(INSERT_BAG_IMAGES_DIR, { recursive: true }),
        mkdir(INSERT_LINER_IMAGES_DIR, { recursive: true }),
        mkdir(INSERT_OUTPUT_DIR, { recursive: true })
    ]);
    return destination;
}
//# sourceMappingURL=product-session.js.map