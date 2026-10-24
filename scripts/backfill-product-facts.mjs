#!/usr/bin/env node
/**
 * backfill-product-facts.mjs
 *
 * 为「已完成产品/」下缺 product-facts.json 的归档目录，本地拼一份 product-facts.json，
 * 不调 ChatGPT、不动主 run-state。
 *
 * 解决：MVP5 generateProductFactsFile 旧版因 BUILDING_PRODUCT_FACTS stage 校验失败，
 *      product-facts.json 漏写，导致店小秘批量上架全 skipped。
 *
 * 数据源（每个产品目录里已有）：
 *   - product-profile.json（lifecycle / identity / artifacts）
 *   - run-state.json（responseText = MVP1 报告、listingContentText = MVP5 文案）
 *   - output/04_LISTING_CONTENT.md（MVP5 listing 全文）
 *   - output/Image_01.png ... Image_10.png（10 张主图）
 *
 * 用法：
 *   node scripts/backfill-product-facts.mjs                 # 扫描全部缺 facts 的产品
 *   node scripts/backfill-product-facts.mjs --product "翻盖发光娃娃挂件"   # 单个
 *   node scripts/backfill-product-facts.mjs --dry-run       # 只打印不写盘
 */
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const COMPLETED_DIR = path.join(ROOT, "已完成产品");
const DIANXIAOMI_TEMPLATE_PRODUCT_ID = "1005005575013300";

// 复制自 dist/src/automation-service.js（未 export 的 helper，不改源码；保持与 MVP5 解析逻辑一致）
// 兼容三种模板变体：
//   A) "3.1 算法标题 Clean Title ... <title>"   —— 中文标准
//   B) "Step 3: 极致落地交付\nClean Title\n...\n<title>"   —— 英文 Step 标题
//   C) "Clean Title\nFinal Title\n\n<title>"   —— 纯英文+Final Title
function extractCleanTitle(listingText) {
    if (!listingText) return "";
    const match = listingText.match(/3\.1\s*[\s\S]*?算法标题\s*Clean Title[\s\S]*?\n\s*\n?\s*([^\n]+?)\s*\n/i);
    if (match && match[1]) {
        const title = match[1].trim();
        if (title.length >= 10) return title;
    }
    // fallback A: Clean Title 后面允许出现 Final Title / 空行 / 字符数统计等次级标签
    // 用 [ \t]* 代替 \s*，防止 \s* 吞掉换行把下一行标题误吞进可选组
    const fallback = listingText.match(/Clean Title[^\n]*\n(?:[ \t]*[^\n]*\n)?(?:[ \t]*\n)*[ \t]*([^\n]{10,}?)[ \t]*\n/i);
    if (fallback && fallback[1]) {
        const title = fallback[1].trim();
        if (title.length >= 10) return title;
    }
    return "";
}

function extractAeoSection(listingText) {
    if (!listingText) return "";
    // 兼容：
    //   A) "3.2 AEO 结构化五点描述 Bullet Points & Q&A"
    //   B) "Step 3: 极致落地交付\nAEO Structured Bullet Points"
    const startPatterns = [
        /3\.2\s*[\s\S]*?(?:AEO\s*结构化五点描述|Bullet Points And Q(?:\s*&\s*|\s+And\s+)A|Bullet Points And Q And A)[\s\S]*?\n/i,
        /AEO\s*结构化五点描述[\s\S]*?\n/i,
        /AEO\s*Structured\s*Bullet\s*Points[\s\S]*?\n/i,
        /AEO\s*Bullet\s*Points[\s\S]*?\n/i
    ];
    let startMatch = null;
    for (const re of startPatterns) {
        startMatch = listingText.match(re);
        if (startMatch) break;
    }
    if (!startMatch) return "";
    const startIndex = startMatch.index + startMatch[0].length;
    const remainder = listingText.slice(startIndex);
    const endMatch = remainder.match(/\n\s*(?:3\.\d+\s+|Step\s+\d+\s*[:|]|#{1,6}\s+3\.\d+|#{1,6}\s+Step\s+\d+)/i);
    const endIndex = endMatch ? endMatch.index : remainder.length;
    return remainder.slice(0, endIndex).trim();
}

// 复制自 dist/src/dianxiaomi-facts.js normalizeDianxiaomiFacts（核心字段）
function normalizeDianxiaomiFacts(raw) {
    const now = new Date().toISOString();
    const base = {
        schemaVersion: "1.0",
        productId: DIANXIAOMI_TEMPLATE_PRODUCT_ID,
        title: { zh: "", en: "" },
        category: "",
        brand: null,
        material: null,
        origin: {},
        keyAttributes: [],
        variants: { dimensions: [], skus: [], matrix: [], colors: [], sizes: [], defaultPrice: "", defaultStock: "", defaultWeight: "", colorImages: {}, colorCustomNames: {} },
        images: { main: [] },
        unit: null,
        originalBox: null,
        weight: null,
        dimensionsCm: {},
        description: { pc: "", mobile: "" },
        hsCode: "",
        compliance: {},
        sourceUrl: "",
        meta: { source: "backfilled_from_listing_artifacts", confirmed: false, createdAt: now, updatedAt: now }
    };
    if (raw && typeof raw === "object") {
        if (raw.title) {
            if (raw.title.zh) base.title.zh = String(raw.title.zh);
            if (raw.title.en) base.title.en = String(raw.title.en);
        }
        if (raw.category != null) base.category = String(raw.category);
        if (raw.brand != null) base.brand = String(raw.brand);
        if (raw.material != null) base.material = String(raw.material);
        if (raw.origin && typeof raw.origin === "object") base.origin = raw.origin;
        if (raw.variants && Array.isArray(raw.variants.colors)) base.variants.colors = raw.variants.colors.map(String);
        if (raw.variants && Array.isArray(raw.variants.sizes)) base.variants.sizes = raw.variants.sizes.map(String);
        if (raw.images && Array.isArray(raw.images.main)) base.images.main = raw.images.main.map(String);
        if (raw.description) {
            if (raw.description.pc) base.description.pc = String(raw.description.pc);
            if (raw.description.mobile) base.description.mobile = String(raw.description.mobile);
            else if (raw.description.pc) base.description.mobile = base.description.pc;
        }
        if (raw.hsCode != null) base.hsCode = String(raw.hsCode);
        if (raw.compliance && typeof raw.compliance === "object") base.compliance = raw.compliance;
    }
    return base;
}

function pickMainImages(outDir) {
    // 与 dist/src/automation-service.js:922-953 一致：output/Image_01.png~Image_06.png 优先
    return readdir(outDir).then((files) => {
        const generated = files
            .filter((f) => /^Image_\d+\.(png|jpg|jpeg|webp)$/i.test(f))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .slice(0, 6);
        return generated;
    }).catch(() => []);
}

// 兜底：seo_content_only 产品没作图，output/ 下无 Image_*.png；用 产品图/ 里的源图顶替
async function pickMainImagesWithFallback(outDir, productImagesDir) {
    const generated = await pickMainImages(outDir);
    if (generated.length) return generated;
    try {
        const files = await readdir(productImagesDir);
        const sources = files
            .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .slice(0, 6);
        return sources;
    } catch { return []; }
}

function extractMaterialFromMvp1(reportText) {
    if (!reportText) return null;
    // 常见中英表达
    const m = reportText.match(/(?:主材质|材质|Material)\s*[：:]\s*([^\n\r]{1,40})/i);
    return m ? m[1].trim() : null;
}

function extractOriginFromMvp1(reportText) {
    if (!reportText) return {};
    const m = reportText.match(/(?:产地|生产地|Place of Origin|Origin|发货地)\s*[：:]\s*([^\n\r]{1,40})/i);
    if (!m) return {};
    return { country: m[1].trim() };
}

async function backfillOne(name, dryRun) {
    const dir = path.join(COMPLETED_DIR, name);
    const factsPath = path.join(dir, "product-facts.json");
    if (existsSync(factsPath)) {
        return { name, status: "skip", reason: "已有 product-facts.json" };
    }
    const profilePath = path.join(dir, "product-profile.json");
    const runStatePath = path.join(dir, "run-state.json");
    const outDir = path.join(dir, "output");
    if (!existsSync(profilePath) || !existsSync(runStatePath) || !existsSync(outDir)) {
        return { name, status: "skip", reason: "缺少 product-profile / run-state / output 三件套之一" };
    }
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    const runState = JSON.parse(await readFile(runStatePath, "utf8"));
    const listingText = (runState.listingContentText || "").trim()
        || await (async () => {
            try {
                return (await readFile(path.join(outDir, "04_LISTING_CONTENT.md"), "utf8")).trim();
            } catch { return ""; }
        })();
    const cleanTitle = extractCleanTitle(listingText);
    // Clean Title 通常是英文（速卖通渠道），zh 用档案里的中文 displayName 兜底
    const cleanTitleIsAscii = /^[A-Za-z0-9 ,.&'()\-+/]+$/.test(cleanTitle);
    const aeo = extractAeoSection(listingText);
    const productImagesDir = path.join(dir, "产品图");
    const images = await pickMainImagesWithFallback(outDir, productImagesDir);
    const reportText = runState.responseText || "";
    const raw = {
        title: {
            zh: profile.identity?.displayName || name,
            en: cleanTitleIsAscii ? cleanTitle : ""
        },
        category: profile.identity?.category || "",
        material: extractMaterialFromMvp1(reportText),
        origin: extractOriginFromMvp1(reportText),
        description: { pc: aeo, mobile: aeo },
        images: { main: images }
    };
    const facts = normalizeDianxiaomiFacts(raw);
    if (!facts.title.zh && !facts.title.en) return { name, status: "fail", reason: "未提取到标题（displayName 与 Clean Title 都为空）" };
    if (!facts.description.pc) return { name, status: "fail", reason: "未提取到 AEO 五点描述" };
    if (!facts.images.main.length) return { name, status: "fail", reason: "output/ 下无 Image_*.png" };
    if (dryRun) {
        return { name, status: "dry-run", title: facts.title.zh, images: facts.images.main.length, aeoLen: facts.description.pc.length };
    }
    await writeFile(factsPath, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    return { name, status: "ok", title: facts.title.zh, images: facts.images.main.length, aeoLen: facts.description.pc.length };
}

async function main() {
    const args = process.argv.slice(2);
    const only = args.includes("--product") ? args[args.indexOf("--product") + 1] : null;
    const dryRun = args.includes("--dry-run");
    if (!existsSync(COMPLETED_DIR)) {
        console.error(`找不到目录: ${COMPLETED_DIR}`);
        process.exit(1);
    }
    const names = only
        ? [only]
        : (await readdir(COMPLETED_DIR, { withFileTypes: true }))
            .filter((d) => d.isDirectory() && !d.name.startsWith("."))
            .map((d) => d.name);
    let ok = 0, skip = 0, fail = 0, dry = 0;
    console.log(`扫 ${names.length} 个产品目录（${dryRun ? "DRY-RUN" : "实写"}）：\n`);
    for (const name of names) {
        const r = await backfillOne(name, dryRun);
        if (r.status === "ok") { ok++; console.log(`✅ ${r.name}\n   title=${r.title}\n   images=${r.images} aeoLen=${r.aeoLen}`); }
        else if (r.status === "skip") { skip++; console.log(`⏭  ${r.name}  ${r.reason}`); }
        else if (r.status === "dry-run") { dry++; console.log(`🔍 ${r.name}\n   title=${r.title}\n   images=${r.images} aeoLen=${r.aeoLen}`); }
        else { fail++; console.log(`❌ ${r.name}  ${r.reason}`); }
    }
    console.log(`\n汇总：ok=${ok} skip=${skip} fail=${fail}${dryRun ? ` dry=${dry}` : ""}`);
    if (fail) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
