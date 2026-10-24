// 幂等进度 manifest（C 硬化）
// 目的：把「某一步的产物是否已完成」从"只信 run-state"升级为"可信的磁盘事实"。
// - recordArtifact：写盘后记录 step → 文件 + sha256 + size + 时间；
// - verifyStep：校验 manifest 记录与磁盘一致（存在 + 校验和匹配）；
// - loadVerifiedText：校验通过则直接复用磁盘文本，**避免重复发送/重复生成**。
//
// 安全设计：manifest 带 productKey（由 objectiveInfo + 源图名派生）。
// 读到时若 productKey 与当前商品不一致，视为无 manifest（忽略旧档），
// 避免「新产品继承上一个产品的 manifest 而误跳过步骤」。
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function computeFileHash(filePath) {
    const buf = await readFile(filePath);
    return createHash("sha256").update(buf).digest("hex");
}

/** 由商品客观信息派生稳定 key（不含 chatUrl，避免换对话后 key 漂移）。 */
export function productKeyOf(state) {
    const parts = [
        state?.objectiveInfo || "",
        (state?.imageNames || []).join("|")
    ];
    return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

export async function readManifest(manifestPath) {
    try {
        return JSON.parse(await readFile(manifestPath, "utf8"));
    }
    catch {
        return null;
    }
}

export async function recordArtifact({ manifestPath, productKey, step, filePath }) {
    const sha256 = await computeFileHash(filePath);
    const info = await stat(filePath);
    let manifest = await readManifest(manifestPath);
    if (!manifest || manifest.productKey !== productKey) {
        manifest = { productKey, steps: {} };
    }
    manifest.steps[step] = {
        // 存相对 manifest 目录的路径（不是 basename）——否则 output/ 下的产物
        // 校验时会被解析到 当前产品/ 根目录而误报 file-missing（真机冒烟发现）。
        file: path.relative(path.dirname(manifestPath), filePath),
        sha256,
        size: info.size,
        savedAt: new Date().toISOString()
    };
    manifest.updatedAt = new Date().toISOString();
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest.steps[step];
}

/** 校验某 step：manifest 命中 + 文件存在 + sha256 一致。 */
export async function verifyStep(manifestPath, productKey, step) {
    const manifest = await readManifest(manifestPath);
    if (!manifest || manifest.productKey !== productKey) {
        return { ok: false, reason: "no-manifest" };
    }
    const entry = manifest.steps?.[step];
    if (!entry) {
        return { ok: false, reason: "no-step" };
    }
    const filePath = path.join(path.dirname(manifestPath), entry.file);
    try {
        const sha256 = await computeFileHash(filePath);
        if (sha256 !== entry.sha256) {
            return { ok: false, reason: "checksum-mismatch" };
        }
        return { ok: true, filePath, entry };
    }
    catch {
        return { ok: false, reason: "file-missing" };
    }
}

/** 校验通过则返回磁盘文本（供断点复用），否则 null。 */
export async function loadVerifiedText(manifestPath, productKey, step) {
    const v = await verifyStep(manifestPath, productKey, step);
    if (!v.ok) {
        return null;
    }
    const text = await readFile(v.filePath, "utf8");
    return text;
}
