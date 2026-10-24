#!/usr/bin/env node
/**
 * cleanup-dup-images.mjs
 *
 * 清理历史 copyFile 留下的产品图/ 重复：
 *   当 产品图/Image_xx.<ext> 与 output/Image_xx.<ext> 同 sha256（按内容相同）时，
 *   视为冗余副本，从 产品图/ 删除（output/ 是新标准的唯一存放地）。
 *
 * 误伤防护：
 *   - 只删 sha256 完全一致的文件，避免「同名但不同内容」被错删。
 *   - 默认 dry-run，打印「即将删除」清单，不写盘。
 *   - --apply 才会真删。
 *
 * 用法：
 *   node scripts/cleanup-dup-images.mjs                # 扫全部，dry-run
 *   node scripts/cleanup-dup-images.mjs --apply        # 真删
 *   node scripts/cleanup-dup-images.mjs --product "翻盖发光娃娃挂件"   # 单个
 */

import { existsSync } from "node:fs";
import { readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const COMPLETED_DIR = path.join(ROOT, "已完成产品");

async function hashFile(absPath) {
    try {
        const buf = await readFile(absPath);
        return createHash("sha256").update(buf).digest("hex");
    } catch { return null; }
}

async function listImages(dir) {
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
        if (!e.isFile()) continue;
        const abs = path.join(dir, e.name);
        if (!/\.(png|jpe?g|webp)$/i.test(e.name)) continue;
        out.push({ name: e.name, abs, size: (await stat(abs).catch(() => ({ size: 0 }))).size, hash: await hashFile(abs) });
    }
    return out;
}

async function cleanOne(name, apply) {
    const dir = path.join(COMPLETED_DIR, name);
    const imagesDir = path.join(dir, "产品图");
    const outputDir = path.join(dir, "output");
    if (!existsSync(dir)) return { name, removed: 0, skipped: ["目录不存在"] };
    if (!existsSync(imagesDir) || !existsSync(outputDir)) return { name, removed: 0, skipped: ["缺 产品图/ 或 output/"] };

    const imgs = await listImages(imagesDir);
    const outs = await listImages(outputDir);
    const outByHash = new Map();
    for (const f of outs) if (f.hash) outByHash.set(f.hash, f);

    let removed = 0;
    const skipped = [];
    for (const f of imgs) {
        if (!f.hash) { skipped.push(`no hash: 产品图/${f.name}`); continue; }
        if (outByHash.has(f.hash)) {
            const dup = outByHash.get(f.hash);
            const skipReason = `产品图/${f.name} (sha256=${f.hash.slice(0, 8)}) ↔ output/${dup.name} 同 sha`;
            if (apply) {
                await unlink(f.abs);
                removed++;
                console.log(`  🗑️  ${skipReason}`);
            } else {
                console.log(`  [dry-run] ${skipReason}`);
                skipped.push(skipReason);
            }
        }
    }
    return { name, removed, skipped };
}

async function main() {
    const args = process.argv.slice(2);
    const apply = args.includes("--apply");
    const only = args.includes("--product") ? args[args.indexOf("--product") + 1] : null;
    if (!existsSync(COMPLETED_DIR)) { console.error(`找不到目录: ${COMPLETED_DIR}`); process.exit(1); }

    const names = only
        ? [only]
        : (await readdir(COMPLETED_DIR, { withFileTypes: true }))
            .filter((d) => d.isDirectory() && !d.name.startsWith("."))
            .map((d) => d.name);

    console.log(`扫 ${names.length} 个产品目录（${apply ? "实删" : "DRY-RUN"}）：\n`);

    let totalRemoved = 0;
    let totalDryRun = 0;
    for (const n of names) {
        console.log(`=== ${n} ===`);
        const r = await cleanOne(n, apply);
        totalRemoved += r.removed;
        totalDryRun += r.skipped.filter((s) => s.includes("↔")).length;
        if (r.removed === 0 && r.skipped.length === 0) console.log("  无重复");
    }

    if (apply) {
        console.log(`\n汇总：已删 ${totalRemoved} 个 sha256 重复文件`);
    } else {
        console.log(`\n汇总：dry-run 共发现 ${totalDryRun} 个 sha256 重复文件（未实际写盘）`);
        if (totalDryRun > 0) console.log(`\n要真删请加 --apply：node scripts/cleanup-dup-images.mjs --apply`);
    }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });