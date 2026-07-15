import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { downloadPublicImage } from "./image-files.js";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
function extension(buffer) {
    if (buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff)
        return ".jpg";
    if (buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return ".png";
    if (buffer.length >= 12 &&
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP")
        return ".webp";
    return undefined;
}
function safeName(value) {
    return path.basename(value).replace(/[^a-zA-Z0-9._ -]/g, "_") || "image";
}
export async function scanImages(directory, options = {}) {
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    const result = [];
    const hashes = new Set();
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile() || !/\.(jpe?g|png|webp)$/i.test(entry.name))
            continue;
        const imagePath = path.join(directory, entry.name);
        const content = await readFile(imagePath);
        const sha256 = createHash("sha256").update(content).digest("hex");
        if (!options.preserveDuplicates && hashes.has(sha256))
            continue;
        hashes.add(sha256);
        result.push({
            path: imagePath,
            name: entry.name,
            size: content.length,
            sha256
        });
    }
    return result;
}
export async function importImagesToDirectory(directory, files, preferredNames = [], options = {}) {
    await mkdir(directory, { recursive: true });
    const existing = await scanImages(directory, {
        preserveDuplicates: options.allowDuplicateContent
    });
    const hashes = new Set(existing.map((image) => image.sha256));
    const names = new Set((await readdir(directory)).map((name) => name.toLowerCase()));
    const result = {
        imported: [],
        skippedDuplicates: [],
        rejected: []
    };
    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const detected = extension(file.buffer);
        if (!detected || file.buffer.length > MAX_IMAGE_BYTES) {
            result.rejected.push(file.originalname);
            continue;
        }
        const sha256 = createHash("sha256").update(file.buffer).digest("hex");
        if (!options.allowDuplicateContent && hashes.has(sha256)) {
            result.skippedDuplicates.push(file.originalname);
            continue;
        }
        const requested = preferredNames[index]
            ? `${safeName(preferredNames[index])}${detected}`
            : `${safeName(path.basename(file.originalname, path.extname(file.originalname)))}${detected}`;
        let candidate = requested;
        let suffix = 2;
        while (names.has(candidate.toLowerCase())) {
            candidate = `${path.basename(requested, detected)}-${suffix}${detected}`;
            suffix += 1;
        }
        await writeFile(path.join(directory, candidate), file.buffer);
        names.add(candidate.toLowerCase());
        hashes.add(sha256);
        result.imported.push(candidate);
    }
    return result;
}
export async function importImageUrlsToDirectory(directory, rawUrls, preferredNames = [], options = {}) {
    const urls = [...new Set(rawUrls.map((url) => url.trim()).filter(Boolean))];
    if (!urls.length)
        throw new Error("请至少输入一个图片 URL");
    if (urls.length > 12)
        throw new Error("一次最多导入 12 个图片 URL");
    const files = [];
    const rejected = [];
    const acceptedNames = [];
    for (let index = 0; index < urls.length; index += 1) {
        const rawUrl = urls[index];
        try {
            const buffer = await downloadPublicImage(rawUrl);
            const parsed = new URL(rawUrl);
            const originalname = path.basename(decodeURIComponent(parsed.pathname)) ||
                `url-image-${index + 1}`;
            files.push({
                originalname,
                buffer
            });
            acceptedNames.push(preferredNames[index] ?? "");
        }
        catch {
            rejected.push(rawUrl);
        }
    }
    const result = await importImagesToDirectory(directory, files, acceptedNames, options);
    result.rejected.push(...rejected);
    return result;
}
export async function removeImageFromDirectory(directory, name) {
    const fileName = path.basename(name);
    if (fileName !== name || !/\.(jpe?g|png|webp)$/i.test(fileName)) {
        throw new Error("无效图片文件名");
    }
    await unlink(path.join(directory, fileName));
}
//# sourceMappingURL=directory-images.js.map