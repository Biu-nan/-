#!/usr/bin/env node
/**
 * verify-product-layout.mjs
 *
 * 校验「已完成产品/」下每个产品目录是否符合新标准：
 *   产品图/       ← 仅源图（用户原始输入/1688 抓取）
 *   output/       ← 仅 ChatGPT 产物（SEO/Lisitng md、Image_*.png、Video_*.mp4）
 *   product-facts.json / product-profile.json / run-state.json
 *
 * 报告：
 *   - A) 产品图/ 下出现 ChatGPT 生成图（Image_*.png/jpg/webp）→ 重复，需清理
 *   - B) 产品图/ 下出现 ChatGPT 文本产物（03_SEO_KEYWORDS.md / 04_LISTING_CONTENT.md）→ 错放
 *   - C) output/ 下出现疑似源图（Detail_*.jpg / O1CN*.jpg / source_* 等）→ 重复
 *   - D) sha256 跨目录重复（同名不同内容 / 同名同内容）→ 重复
 *   - E) 缺失关键文件（product-facts.json / run-state.json / product-profile.json）
 *
 * 用法：
 *   node scripts/verify-product-layout.mjs                # 扫描全部，列出问题
 *   node scripts/verify-product-layout.mjs --product "悍匪毛绒钥匙扣 (2)"   # 单个
 *   node scripts/verify-product-layout.mjs --strict       # 把"建议"也算错误
 */

import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const COMPLETED_DIR = path.join(ROOT, "已完成产品");

// 标准分区文件模式
const AI_ARTIFACT_IN_PRODUCT_IMAGES = /^Image_\d+\.(png|jpe?g|webp)$/i;
const AI_TEXT_FILES = /^(03_SEO_KEYWORDS|04_LISTING_CONTENT)\.md$/i;
const SOURCE_IMAGE_HINT = /^(Detail_|O1CN\d+|source_|IMG_|DSC_|Wechat_)/i; // 1688 / 微信 / 普通命名
const AI_VIDEO_FILES = /^Video_\d+\.(mp4|mov|webm)$/i;

async function hashFile(absPath) {
    try {
        const buf = await readFile(absPath);
        return createHash("sha256").update(buf).digest("hex").slice(0, 12);
    } catch { return null; }
}

async function inspectDir(dir) {
    if (!existsSync(dir)) return { exists: false, files: [] };
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
        if (!e.isFile()) continue;
        const abs = path.join(dir, e.name);
        const st = await stat(abs).catch(() => null);
        if (!st) continue;
        files.push({ name: e.name, abs, size: st.size, hash: await hashFile(abs) });
    }
    return { exists: true, files };
}

async function checkOne(name, strict) {
    const dir = path.join(COMPLETED_DIR, name);
    if (!existsSync(dir)) return { name, status: "missing", issues: ["目录不存在"] };

    const imagesDir = path.join(dir, "产品图");
    const outputDir = path.join(dir, "output");
    const factsFile = path.join(dir, "product-facts.json");
    const profileFile = path.join(dir, "product-profile.json");
    const runStateFile = path.join(dir, "run-state.json");

    const issues = [];

    // 关键文件
    if (!existsSync(factsFile)) issues.push({ severity: "error", code: "E_MISSING_FACTS", msg: "缺 product-facts.json" });
    if (!existsSync(profileFile)) issues.push({ severity: "warn", code: "E_MISSING_PROFILE", msg: "缺 product-profile.json" });
    if (!existsSync(runStateFile)) issues.push({ severity: "warn", code: "E_MISSING_RUNSTATE", msg: "缺 run-state.json" });

    const imgs = await inspectDir(imagesDir);
    const outs = await inspectDir(outputDir);

    // A) 产品图/ 出现 AI 生成图（按文件名）
    for (const f of imgs.files) {
        if (AI_ARTIFACT_IN_PRODUCT_IMAGES.test(f.name)) {
            issues.push({ severity: "error", code: "A_AI_IMAGE_IN_PRODUCT_DIR", msg: `产品图/${f.name} 是 ChatGPT 生成图，应只在 output/` });
        }
        if (AI_TEXT_FILES.test(f.name)) {
            issues.push({ severity: "error", code: "A_AI_TEXT_IN_PRODUCT_DIR", msg: `产品图/${f.name} 是 ChatGPT 文本产物，应只在 output/` });
        }
    }

    // B) output/ 下出现疑似源图（Detail_/O1CN/source_ 等）
    for (const f of outs.files) {
        if (SOURCE_IMAGE_HINT.test(f.name) && /\.(jpe?g|png|webp)$/i.test(f.name)) {
            issues.push({ severity: strict ? "error" : "warn", code: "B_SOURCE_IN_OUTPUT", msg: `output/${f.name} 疑似源图，按新标准应只在 产品图/` });
        }
    }

    // C) 跨目录 sha256 重复
    const imgHashes = new Map();
    for (const f of imgs.files) if (f.hash) imgHashes.set(f.hash, f.name);
    for (const f of outs.files) {
        if (!f.hash) continue;
        if (imgHashes.has(f.hash)) {
            const dup = imgHashes.get(f.hash);
            issues.push({ severity: "error", code: "C_SHA_DUP", msg: `sha256 重复: 产品图/${dup} ↔ output/${f.name}` });
        }
    }

    // D) output/ 下没有 Image_*.png 也没 Video_*.mp4（full_listing 应有生成图）
    const hasImageArtifact = outs.files.some((f) => AI_ARTIFACT_IN_PRODUCT_IMAGES.test(f.name));
    const hasVideoArtifact = outs.files.some((f) => AI_VIDEO_FILES.test(f.name));
    if (!hasImageArtifact && !hasVideoArtifact) {
        issues.push({ severity: "warn", code: "D_NO_AI_ARTIFACT", msg: "output/ 下无 AI 产物（生成图/视频）" });
    }

    // E) 检查 product-facts.images.main 文件名都能 resolve 到（按新标准只看 output/、产品图/ 两层，含 .png/.jpg 互换）
    if (existsSync(factsFile)) {
        try {
            const facts = JSON.parse(await readFile(factsFile, "utf8"));
            const main = facts.images?.main || [];
            for (const f of main) {
                const ext = path.extname(f).toLowerCase();
                const stem = path.basename(f, ext);
                const altExt = (ext === ".png") ? ".jpg" : (ext === ".jpg" || ext === ".jpeg") ? ".png" : null;
                const candidates = [
                    path.join(outputDir, f),
                    path.join(imagesDir, f),
                    path.join(dir, f)
                ];
                if (altExt) {
                    const alt = stem + altExt;
                    candidates.push(path.join(outputDir, alt));
                    candidates.push(path.join(imagesDir, alt));
                    candidates.push(path.join(dir, alt));
                }
                if (!candidates.some((p) => existsSync(p))) {
                    issues.push({ severity: "error", code: "E_FACT_IMAGE_UNRESOLVABLE", msg: `product-facts.images.main[${f}] 在 output/、产品图/、根（含后缀互换）都找不到` });
                }
            }
        } catch (e) {
            issues.push({ severity: "warn", code: "E_FACT_PARSE", msg: `product-facts.json 解析失败: ${e.message}` });
        }
    }

    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warnCount = issues.filter((i) => i.severity === "warn").length;
    return { name, status: errorCount > 0 ? "fail" : (warnCount > 0 ? "warn" : "ok"), summary: { imgs: imgs.files.length, outs: outs.files.length }, issues };
}

async function main() {
    const args = process.argv.slice(2);
    const only = args.includes("--product") ? args[args.indexOf("--product") + 1] : null;
    const strict = args.includes("--strict");
    if (!existsSync(COMPLETED_DIR)) { console.error(`找不到目录: ${COMPLETED_DIR}`); process.exit(1); }

    const names = only
        ? [only]
        : (await readdir(COMPLETED_DIR, { withFileTypes: true }))
            .filter((d) => d.isDirectory() && !d.name.startsWith("."))
            .map((d) => d.name);

    console.log(`扫 ${names.length} 个产品目录（${strict ? "STRICT" : "normal"}）：\n`);

    let ok = 0, warn = 0, fail = 0;
    const allIssues = [];
    for (const n of names) {
        const r = await checkOne(n, strict);
        if (r.status === "ok") ok++;
        else if (r.status === "warn") warn++;
        else fail++;
        if (r.issues.length === 0) {
            console.log(`✅ ${n.padEnd(38)}  产品图=${r.summary.imgs}  output=${r.summary.outs}`);
        } else {
            const icon = r.status === "fail" ? "❌" : "⚠️ ";
            console.log(`${icon} ${n.padEnd(38)}  产品图=${r.summary.imgs}  output=${r.summary.outs}`);
            for (const i of r.issues) {
                console.log(`     [${i.severity.toUpperCase()}] ${i.code}: ${i.msg}`);
                allIssues.push({ name: n, ...i });
            }
        }
    }

    console.log(`\n汇总：ok=${ok} warn=${warn} fail=${fail}（共 ${names.length}）`);
    if (fail > 0) process.exit(2);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });