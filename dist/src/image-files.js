import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRODUCT_IMAGES_DIR } from "./config.js";
const VALID_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_REMOTE_IMAGES = 12;
const MAX_REDIRECTS = 5;
export function isSupportedImage(name) {
    return VALID_EXTENSIONS.has(path.extname(name).toLowerCase());
}
export function hashBuffer(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}
export function detectImageExtension(buffer) {
    if (buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff) {
        return ".jpg";
    }
    if (buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return ".png";
    }
    if (buffer.length >= 12 &&
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP") {
        return ".webp";
    }
    return undefined;
}
export async function scanProductImages() {
    await mkdir(PRODUCT_IMAGES_DIR, { recursive: true });
    const entries = await readdir(PRODUCT_IMAGES_DIR, { withFileTypes: true });
    const images = [];
    const hashes = new Set();
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile() || !isSupportedImage(entry.name))
            continue;
        const imagePath = path.join(PRODUCT_IMAGES_DIR, entry.name);
        const content = await readFile(imagePath);
        const sha256 = hashBuffer(content);
        if (hashes.has(sha256))
            continue;
        hashes.add(sha256);
        images.push({
            path: imagePath,
            name: entry.name,
            size: content.length,
            sha256
        });
    }
    return images;
}
function safeFileName(name) {
    const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, "_");
    return base || `image-${Date.now()}.jpg`;
}
async function availableName(originalName) {
    const entries = new Set(await readdir(PRODUCT_IMAGES_DIR));
    if (!entries.has(originalName))
        return originalName;
    const extension = path.extname(originalName);
    const stem = path.basename(originalName, extension);
    let index = 2;
    while (entries.has(`${stem}-${index}${extension}`))
        index += 1;
    return `${stem}-${index}${extension}`;
}
export async function importProductImages(files) {
    return importImageBuffers(files.map((file) => ({
        originalname: file.originalname,
        buffer: file.buffer
    })));
}
export async function importProductImageUrls(rawUrls) {
    const urls = [...new Set(rawUrls.map((url) => url.trim()).filter(Boolean))];
    if (urls.length === 0)
        throw new Error("请至少输入一个图片 URL");
    if (urls.length > MAX_REMOTE_IMAGES) {
        throw new Error(`一次最多导入 ${MAX_REMOTE_IMAGES} 个图片 URL`);
    }
    const downloaded = [];
    const rejected = [];
    for (let index = 0; index < urls.length; index += 1) {
        const url = urls[index];
        try {
            const buffer = await downloadPublicImage(url);
            const extension = detectImageExtension(buffer);
            if (!extension)
                throw new Error("不是支持的 JPG、PNG 或 WEBP 图片");
            const parsed = new URL(url);
            const urlName = path.basename(decodeURIComponent(parsed.pathname));
            const stem = path.basename(urlName, path.extname(urlName)) || `url-image-${index + 1}`;
            downloaded.push({
                originalname: `${stem}${extension}`,
                buffer
            });
        }
        catch {
            rejected.push(url);
        }
    }
    const result = await importImageBuffers(downloaded);
    result.rejected.push(...rejected);
    return result;
}
async function importImageBuffers(files) {
    await mkdir(PRODUCT_IMAGES_DIR, { recursive: true });
    const existing = await scanProductImages();
    const hashes = new Set(existing.map((image) => image.sha256));
    const result = {
        imported: [],
        skippedDuplicates: [],
        rejected: []
    };
    for (const file of files) {
        const detectedExtension = detectImageExtension(file.buffer);
        if (!detectedExtension || file.buffer.length > MAX_IMAGE_BYTES) {
            result.rejected.push(file.originalname);
            continue;
        }
        const hash = hashBuffer(file.buffer);
        if (hashes.has(hash)) {
            result.skippedDuplicates.push(file.originalname);
            continue;
        }
        const originalExtension = path.extname(file.originalname).toLowerCase();
        const normalizedName = VALID_EXTENSIONS.has(originalExtension)
            ? `${path.basename(file.originalname, originalExtension)}${detectedExtension}`
            : `${file.originalname}${detectedExtension}`;
        const fileName = await availableName(safeFileName(normalizedName));
        await writeFile(path.join(PRODUCT_IMAGES_DIR, fileName), file.buffer);
        hashes.add(hash);
        result.imported.push(fileName);
    }
    return result;
}
export async function downloadPublicImage(rawUrl, redirectCount = 0) {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("仅支持 http 或 https 图片 URL");
    }
    await assertPublicHost(url.hostname);
    const response = await fetch(url, {
        redirect: "manual",
        headers: {
            accept: "image/jpeg,image/png,image/webp",
            "user-agent": "ChatGPT-Listing-MVP/1.0"
        },
        signal: AbortSignal.timeout(30_000)
    });
    if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount >= MAX_REDIRECTS) {
            throw new Error("图片 URL 重定向过多或无效");
        }
        return downloadPublicImage(new URL(location, url).toString(), redirectCount + 1);
    }
    if (!response.ok || !response.body) {
        throw new Error(`图片下载失败：HTTP ${response.status}`);
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES)
        throw new Error("图片超过 15 MB");
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        total += buffer.length;
        if (total > MAX_IMAGE_BYTES)
            throw new Error("图片超过 15 MB");
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}
export async function assertPublicHost(hostname) {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (normalized === "localhost" || normalized.endsWith(".localhost")) {
        throw new Error("不允许访问本机地址");
    }
    const addresses = await lookup(normalized, { all: true });
    if (addresses.length === 0 ||
        addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new Error("不允许访问本机或内网地址");
    }
}
export function isPrivateAddress(address) {
    const value = address.toLowerCase();
    if (value === "::1" || value === "::" || value.startsWith("fe80:")) {
        return true;
    }
    if (value.startsWith("fc") || value.startsWith("fd"))
        return true;
    const ipv4 = value.startsWith("::ffff:") ? value.slice(7) : value;
    const parts = ipv4.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
        return false;
    }
    const [a, b] = parts;
    return (a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) ||
        a >= 224);
}
export async function removeProductImage(name) {
    const fileName = path.basename(name);
    if (fileName !== name || !isSupportedImage(fileName)) {
        throw new Error("无效的图片文件名");
    }
    await unlink(path.join(PRODUCT_IMAGES_DIR, fileName)).catch((error) => {
        if (error.code === "ENOENT") {
            throw new Error("图片不存在或已被删除");
        }
        throw error;
    });
}
export async function clearProductImages() {
    const images = await scanProductImages();
    await Promise.all(images.map((image) => unlink(image.path)));
    return images.length;
}
//# sourceMappingURL=image-files.js.map