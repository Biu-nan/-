/**
 * 参考风格图（Style Reference）—— 「只参考风格，不参考产品信息」的唯一实现层。
 *
 * 背景与边界（2026-10-26 用户确认）：
 *   1. 风格图只允许影响 background / layout / lighting / typography / icon style / visual mood；
 *   2. 参考图里的产品、道具、包装、模特、logo 一律不得进入成品；
 *   3. 风格图**不得**计入 identity lock / visual reference set / 店小秘图源 ——
 *      所以物理上放在 当前产品/风格参考图/，与 产品图/ 完全隔离。
 *
 * 两段式管线：
 *   ① 视觉规划会话：产品图 + 风格图一起上传（prompts/02_*_VISUAL_PLANNING_PROMPT.md 本来就
 *      把「风格参考图」列为输入项 #2），并要求模型额外输出 STYLE_LOCK 六字段 token；
 *   ② 逐张生图：只附产品图，纯文字 token 进 prompt（结构上防止风格图里的产品被复刻）。
 *
 * 诚实机制：模型没输出 STYLE_LOCK → 标记 degraded，逐张生图退化为「通用风格守卫」，
 * 并在 UI 显式提示，绝不静默假装风格已锁定。
 */
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_STYLE_REFERENCE_IMAGES, PRODUCT_STYLE_REF_DIR, STYLE_LOCK_FILE } from "./config.js";
import { detectImageExtension, downloadPublicImage, hashBuffer, isSupportedImage } from "./image-files.js";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const STYLE_LOCK_FIELDS = [
    "background",
    "palette",
    "lighting",
    "typography",
    "icon_style",
    "visual_mood"
];
const STYLE_LOCK_FIELD_LABELS = {
    background: "背景",
    palette: "配色系统",
    lighting: "光影",
    typography: "字体气质",
    icon_style: "图标语言",
    visual_mood: "整体情绪"
};

function safeFileName(name) {
    const base = path.basename(String(name || "")).replace(/[^a-zA-Z0-9._ -]/g, "_").trim();
    return base || `style-${Date.now()}.jpg`;
}

async function availableName(originalName) {
    const entries = new Set(await readdir(PRODUCT_STYLE_REF_DIR));
    if (!entries.has(originalName))
        return originalName;
    const extension = path.extname(originalName);
    const stem = path.basename(originalName, extension);
    let index = 2;
    while (entries.has(`${stem}-${index}${extension}`))
        index += 1;
    return `${stem}-${index}${extension}`;
}

/** 扫描参考风格图目录（去重 + 稳定排序）。空目录返回 []。 */
export async function scanStyleReferenceImages() {
    await mkdir(PRODUCT_STYLE_REF_DIR, { recursive: true });
    const entries = await readdir(PRODUCT_STYLE_REF_DIR, { withFileTypes: true });
    const images = [];
    const hashes = new Set();
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile() || !isSupportedImage(entry.name))
            continue;
        const imagePath = path.join(PRODUCT_STYLE_REF_DIR, entry.name);
        const content = await readFile(imagePath);
        const sha256 = hashBuffer(content);
        if (hashes.has(sha256))
            continue;
        hashes.add(sha256);
        images.push({ path: imagePath, name: entry.name, size: content.length, sha256 });
    }
    return images;
}

/**
 * 导入参考风格图。硬上限 MAX_STYLE_REFERENCE_IMAGES 张（超出返回 rejected，不静默丢弃）。
 * 任何写入 / 删除都会让既有 STYLE_LOCK 失效（stale），因为 prompt pack 已按旧风格生成。
 */
export async function importStyleReferenceImages(files) {
    await mkdir(PRODUCT_STYLE_REF_DIR, { recursive: true });
    const existing = await scanStyleReferenceImages();
    const hashes = new Set(existing.map((image) => image.sha256));
    const result = { imported: [], skippedDuplicates: [], rejected: [], limit: MAX_STYLE_REFERENCE_IMAGES };
    let slots = MAX_STYLE_REFERENCE_IMAGES - existing.length;
    for (const file of files ?? []) {
        if (!file?.buffer?.length) {
            result.rejected.push(file?.originalname ?? "unknown");
            continue;
        }
        const detectedExtension = detectImageExtension(file.buffer);
        if (!detectedExtension || file.buffer.length > MAX_IMAGE_BYTES) {
            result.rejected.push(file.originalname ?? "unknown");
            continue;
        }
        if (slots <= 0) {
            // 先判重再判额度：重复图应提示「已存在」而不是「超上限」，否则用户会以为要删一张。
            const duplicateHash = hashBuffer(file.buffer);
            if (hashes.has(duplicateHash)) {
                result.skippedDuplicates.push(file.originalname ?? "unknown");
            }
            else {
                result.rejected.push(file.originalname ?? "unknown");
            }
            continue;
        }
        const hash = hashBuffer(file.buffer);
        if (hashes.has(hash)) {
            result.skippedDuplicates.push(file.originalname ?? "unknown");
            continue;
        }
        const originalExtension = path.extname(file.originalname ?? "").toLowerCase();
        const normalizedName = isSupportedImage(file.originalname ?? "")
            ? `${path.basename(file.originalname, originalExtension)}${detectedExtension}`
            : `style-reference${detectedExtension}`;
        const fileName = await availableName(safeFileName(normalizedName));
        await writeFile(path.join(PRODUCT_STYLE_REF_DIR, fileName), file.buffer);
        hashes.add(hash);
        slots -= 1;
        result.imported.push(fileName);
    }
    return result;
}

/**
 * 通过图片直链导入参考风格图（与产品图 URL 导入共用同一套下载 + 内网地址拦截护栏）。
 * 单条下载失败只计入 rejected，不影响其余；超出剩余额度同样计入 rejected。
 */
export async function importStyleReferenceImageUrls(rawUrls) {
    const urls = [...new Set((rawUrls ?? []).map((url) => String(url ?? "").trim()).filter(Boolean))];
    if (urls.length === 0)
        throw new Error("请至少输入一个图片 URL");
    const existing = await scanStyleReferenceImages();
    if (existing.length >= MAX_STYLE_REFERENCE_IMAGES) {
        throw new Error(`参考风格图已达上限 ${MAX_STYLE_REFERENCE_IMAGES} 张，请先删除一张再导入`);
    }
    const downloaded = [];
    const rejected = [];
    for (const url of urls) {
        try {
            const buffer = await downloadPublicImage(url);
            const extension = detectImageExtension(buffer);
            if (!extension)
                throw new Error("不是支持的 JPG、PNG 或 WEBP 图片");
            const parsed = new URL(url);
            const urlName = path.basename(decodeURIComponent(parsed.pathname));
            const stem = path.basename(urlName, path.extname(urlName)) || "style-reference";
            downloaded.push({ originalname: `${stem}${extension}`, buffer });
        }
        catch {
            rejected.push(url);
        }
    }
    const result = await importStyleReferenceImages(downloaded);
    result.rejected.push(...rejected);
    return result;
}

export async function removeStyleReferenceImage(name) {
    const fileName = path.basename(String(name || ""));
    if (fileName !== name || !isSupportedImage(fileName)) {
        throw new Error("无效的参考风格图文件名");
    }
    await unlink(path.join(PRODUCT_STYLE_REF_DIR, fileName)).catch((error) => {
        if (error.code === "ENOENT") {
            throw new Error("参考风格图不存在或已被删除");
        }
        throw error;
    });
    return fileName;
}

export async function clearStyleReferenceImages() {
    const images = await scanStyleReferenceImages();
    for (const image of images) {
        await unlink(image.path).catch(() => { });
    }
    return images.length;
}

export async function readStyleLock() {
    try {
        const parsed = JSON.parse(await readFile(STYLE_LOCK_FILE, "utf8"));
        if (!parsed || typeof parsed !== "object")
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}

export async function writeStyleLock(record) {
    await mkdir(path.dirname(STYLE_LOCK_FILE), { recursive: true });
    const payload = {
        schema_version: "1.0",
        created_at: new Date().toISOString(),
        ...record
    };
    await writeFile(STYLE_LOCK_FILE, `${JSON.stringify(payload, null, 2)}\n`);
    return payload;
}

/**
 * 风格图变动后让旧锁定失效。不删除 planningText、不自动重跑 ——
 * 是否重跑由用户在 UI 决定，这里只负责「不假装仍然一致」。
 */
export async function invalidateStyleLock(reason) {
    const current = await readStyleLock();
    if (!current)
        return undefined;
    return writeStyleLock({
        ...current,
        created_at: new Date().toISOString(),
        stale: true,
        stale_reason: reason,
        stale_at: new Date().toISOString()
    });
}

/**
 * 从视觉规划回复里提取 STYLE_LOCK 六字段 token。
 * 缺失 / JSON 坏 → 返回 undefined（调用方必须走 degraded 路径，不得编造 token）。
 */
export function extractStyleLockFromPlanning(text) {
    if (!text || typeof text !== "string")
        return undefined;
    const match = text.match(/<<<STYLE_LOCK_JSON_START>>>([\s\S]*?)<<<STYLE_LOCK_JSON_END>>>/);
    if (!match)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(match[1].trim());
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== "object")
        return undefined;
    const tokens = {};
    for (const field of STYLE_LOCK_FIELDS) {
        const value = parsed[field];
        if (typeof value === "string" && value.trim()) {
            tokens[field] = value.trim().slice(0, 300);
        }
    }
    return Object.keys(tokens).length > 0 ? tokens : undefined;
}

/**
 * 规划阶段追加到视觉规划 Prompt 尾部的风格接入声明。
 * 没有任何风格图时返回空串 —— 旧流程的 prompt 一个字节都不变。
 */
export function buildStylePlanningBlock(styleReferenceCount) {
    const count = typeof styleReferenceCount === "number"
        ? styleReferenceCount
        : (styleReferenceCount?.length ?? 0);
    if (count <= 0)
        return "";
    return `---

# 参考风格图接入（本次已上传 ${count} 张）

本对话除产品实拍图外，另附 ${count} 张「参考风格图」。它们是风格样本，**不是销售商品**。

铁律：

1. 产品主体只能来自本对话的产品实拍图。参考风格图中的任何产品、道具、包装、模特、logo、品牌标识一律不得出现在成品图里，也不得写入产品事实、卖点、材质、尺寸与 SKU。
2. 参考风格图只允许影响：background / layout / lighting / typography / icon style / visual mood。
3. 若参考风格图中的物品与本商品同类，不得参考其造型、结构、材质、颜色或图案，只允许沿用第 2 条的六项风格属性。
4. 违反第 1–3 条视为货不对板，优先级高于任何视觉美观要求。

请在本条回复的 A 部分末尾，额外输出一行风格锁定（只描述风格，不描述任何产品；每项一句英文，缺失可整块省略，但不得编造与参考图无关的风格）：

<<<STYLE_LOCK_JSON_START>>>
{"background":"...","palette":"...","lighting":"...","typography":"...","icon_style":"...","visual_mood":"..."}
<<<STYLE_LOCK_JSON_END>>>
`;
}

/**
 * 逐张生图使用的风格约束块：只有存在参考风格图时才返回非空。
 * 有 token → 注入六项锁定值；无 token / 已 stale → 退化为通用守卫并标记 degraded。
 */
export async function buildStyleGenerationClause() {
    const styleImages = await scanStyleReferenceImages();
    if (styleImages.length === 0) {
        return { clause: "", degraded: false, reason: undefined, tokens: undefined };
    }
    const lock = await readStyleLock();
    const tokens = lock && !lock.stale && lock.tokens && typeof lock.tokens === "object"
        ? lock.tokens
        : undefined;
    const lines = [];
    lines.push("# 风格约束（参考风格图只给风格，不给产品）");
    lines.push("");
    lines.push("本对话历史中另有参考风格图。它们只提供风格，不是商品，也不是配件来源。");
    lines.push("只允许沿用其：背景类型、版式结构、光影方向与质感、字体气质、图标语言、整体情绪。");
    lines.push("禁止复制参考风格图中的任何产品、道具、包装、模特、logo 或品牌元素；");
    lines.push("禁止改变当前商品的结构、材质、颜色、图案、配件与数量。产品主体只能来自当前商品的源图附件。");
    if (tokens) {
        lines.push("");
        lines.push("本次已锁定的风格参数（必须服从）：");
        for (const field of STYLE_LOCK_FIELDS) {
            const value = tokens[field];
            if (value)
                lines.push(`- ${STYLE_LOCK_FIELD_LABELS[field]}（${field}）：${value}`);
        }
    }
    else {
        lines.push("");
        lines.push("本次未取得模型风格锁定（degraded），请按上述通则沿用参考图的风格，不得自行发明风格，也不得复刻参考图中的物体。");
    }
    return {
        clause: lines.join("\n"),
        degraded: !tokens,
        reason: tokens ? undefined : (lock?.stale ? "风格参考图已变更，需重跑视觉规划" : "视觉规划未输出 STYLE_LOCK"),
        tokens
    };
}

/** 前端展示用的完整状态。 */
export async function getStyleReferenceStatus() {
    const [images, lock] = await Promise.all([scanStyleReferenceImages(), readStyleLock()]);
    return {
        images: images.map((image, index) => ({
            name: image.name,
            size: image.size,
            sha256: image.sha256,
            order: index + 1,
            url: `/api/style-ref-images/${encodeURIComponent(image.name)}`
        })),
        limit: MAX_STYLE_REFERENCE_IMAGES,
        lock: lock ?? null,
        locked: Boolean(lock && lock.tokens && !lock.stale),
        degraded: Boolean(lock && (lock.degraded || lock.stale)),
        stale: Boolean(lock?.stale),
        style_reference_hashes: images.map((image) => image.sha256)
    };
}
