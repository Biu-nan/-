import { readdir } from "node:fs/promises";
import path from "node:path";
import { DIANXIAOMI_TEMPLATE_PRODUCT_ID } from "./config.js";
import { extractTitle as extractTitleFromListing } from "./listing-contract.js";
// 店小秘 ERP 产品事实标准化（单真相源）。
// 上品流程（generateSeoListingContent 桥接）与店小秘引用上架（reference-apply）
// 共用此函数，保证两侧写入/消费的 product-facts 形状一致。
export function normalizeDianxiaomiFacts(raw) {
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
        meta: { source: "ai_extracted", confirmed: false, createdAt: now, updatedAt: now }
    };
    if (raw && typeof raw === "object") {
        if (raw.meta?.provenance && typeof raw.meta.provenance === "object" && !Array.isArray(raw.meta.provenance)) {
            base.meta.provenance = structuredClone(raw.meta.provenance);
        }
        if (raw.title) {
            base.title.zh = raw.title.zh ? String(raw.title.zh) : base.title.zh;
            base.title.en = raw.title.en ? String(raw.title.en) : base.title.en;
        }
        if (raw.category != null)
            base.category = String(raw.category);
        if (raw.brand != null)
            base.brand = String(raw.brand);
        if (raw.material != null)
            base.material = String(raw.material);
        if (raw.origin && typeof raw.origin === "object")
            base.origin = raw.origin;
        if (Array.isArray(raw.keyAttributes)) {
            base.keyAttributes = raw.keyAttributes
                .filter((a) => a && a.name)
                .map((a) => ({ name: String(a.name), value: String(a.value ?? "") }));
        }
        if (raw.variants && typeof raw.variants === "object") {
            if (Array.isArray(raw.variants.dimensions))
                base.variants.dimensions = raw.variants.dimensions.map(String);
            // 透传 SKU 规划矩阵（save-variants 写入的 variants.matrix / colors / sizes / 默认值），不打丢
            if (Array.isArray(raw.variants.matrix))
                base.variants.matrix = raw.variants.matrix;
            if (Array.isArray(raw.variants.colors))
                base.variants.colors = raw.variants.colors.map(String);
            if (Array.isArray(raw.variants.sizes))
                base.variants.sizes = raw.variants.sizes.map(String);
            if (raw.variants.defaultPrice != null) base.variants.defaultPrice = raw.variants.defaultPrice;
            if (raw.variants.defaultStock != null) base.variants.defaultStock = raw.variants.defaultStock;
            if (raw.variants.defaultWeight != null) base.variants.defaultWeight = raw.variants.defaultWeight;
            // 透传每色图与颜色自定义名（save-variants 写入；前端 SKU 规划卡）
            if (raw.variants.colorImages && typeof raw.variants.colorImages === "object")
                base.variants.colorImages = raw.variants.colorImages;
            if (raw.variants.colorCustomNames && typeof raw.variants.colorCustomNames === "object")
                base.variants.colorCustomNames = raw.variants.colorCustomNames;
            // 透传批量上架注入的箱包颜色映射（colorMap）
            if (Array.isArray(raw.variants.colorMap))
                base.variants.colorMap = raw.variants.colorMap.map((c) => ({ color: String(c.color || ""), customName: String(c.customName || ""), image: String(c.image || "") }));
            if (Array.isArray(raw.variants.skus)) {
                base.variants.skus = raw.variants.skus.map((s) => ({
                    combination: Array.isArray(s.combination) ? s.combination.map(String) : [],
                    stock: Number(s.stock) || 0,
                    price: Number(s.price) || 0,
                    sku: s.sku ? String(s.sku) : "",
                    barcode: s.barcode ? String(s.barcode) : "",
                    weight: s.weight != null ? Number(s.weight) : null,
                    dimensionsCm: s.dimensionsCm && typeof s.dimensionsCm === "object" ? s.dimensionsCm : {}
                }));
            }
        }
        if (raw.unit != null)
            base.unit = String(raw.unit);
        if (raw.weight != null)
            base.weight = Number(raw.weight);
        if (raw.dimensionsCm && typeof raw.dimensionsCm === "object")
            base.dimensionsCm = raw.dimensionsCm;
        if (raw.description && typeof raw.description === "object") {
            base.description.pc = raw.description.pc ? String(raw.description.pc) : "";
            base.description.mobile = raw.description.mobile ? String(raw.description.mobile) : "";
        }
        if (raw.images && typeof raw.images === "object") {
            base.images = {
                main: Array.isArray(raw.images.main) ? raw.images.main.map(String) : []
            };
        }
        if (raw.hsCode != null)
            base.hsCode = String(raw.hsCode);
        if (raw.compliance && typeof raw.compliance === "object")
            base.compliance = raw.compliance;
        if (raw.sourceUrl != null)
            base.sourceUrl = String(raw.sourceUrl);
        if (raw.mainKeyword != null)
            base.mainKeyword = String(raw.mainKeyword);
    }
    if (!base.mainKeyword)
        base.mainKeyword = "Nipple Covers";
    return base;
}
// 本地兜底：不依赖 ChatGPT，从已保存的 Listing 文本 + 本地图片目录直接构造「可用」的 product-facts.json。
// 用于三类场景，保证下游（店小秘上架）不会因缺文件而整批跳过：
//  1) generateProductFactsFile 的 AI 桥接静默失败；
//  2) 归档时仍缺文件（skipProductFacts 批量模式 / 历史包）；
//  3) 采集箱批量上架模板生成时发现包内缺文件。
// 只保证 checkDianxiaomiFactsReady 要求的 标题 / 详情页 / 主图 三项齐全；颜色/尺寸/价格等留空，
// 由店小秘上架端 autofix 兜底填必填项。质量为「降级但可上架」，meta.source 标记为 local_fallback。
export async function buildProductFactsFallback({ factText = "", listingContentText = "", baseDir = "" } = {}) {
    const titleEn = extractCleanTitleLocal(listingContentText);
    const aeo = extractDetailLocal(listingContentText);
    const images = await collectImagesFromDir(baseDir);
    const material = extractField(factText, ["材质", "material"]);
    const brand = extractField(factText, ["品牌", "brand"]);
    const raw = {
        title: { zh: "", en: titleEn },
        category: "",
        brand: brand || null,
        material: material || null,
        description: {
            pc: aeo || listingContentText.slice(0, 4000),
            mobile: aeo || listingContentText.slice(0, 4000)
        },
        images: { main: images },
        variants: { matrix: [] },
        meta: { source: "local_fallback", confirmed: false }
    };
    const facts = normalizeDianxiaomiFacts(raw);
    facts.meta = Object.assign({}, facts.meta, { source: "local_fallback", confirmed: false });
    return facts;
}
// 从 Listing 文案提取 Clean Title。兼容两种写法：
//  - 含「3.1 算法标题 Clean Title」章节（标准 prompt）；
//  - 含「Clean Title 强制校验版」+ 下一行「Final Title」（批量制作 seo_content_only 写法）。
// 关键：跳过「Final Title / Clean Title / 字符核算」等标签行，取第一个像真实标题的行。
function extractCleanTitleLocal(listingText) {
    // 2026-10-27：改为调用 listing-contract.js 的 extractTitle（从 ecom 的
    // src/listing_contract.py 移植，已用真实产物做过金标对比）。
    //
    // 被替换掉的旧实现只认 "Clean Title" 这一种标签、只看其后 5 行、
    // 长度 10–220 就返回。实测 450 份历史产物里有 **22 份（4.9%）不含该标签**，
    // 旧实现对它们恒返回空 → facts 缺标题 → 产品上不了架。
    // 而那正是 ecom 侧反复复发六次（O-002/004/007/013/014/O-082）的「格式漂移」问题：
    // 措辞永远枚举不完，所以新实现改成「多措辞正则 → 围栏 → 标签行后继 →
    // 126–128 优先 → 「核算字符数」锚点回退 → 最长英文候选兜底」。
    //
    // 保留函数名不动：本函数只在本文件被调用一次（buildProductFactsFallback），
    // 留一个薄封装比改名更能说明「这里曾经有过另一套解析逻辑」。
    return extractTitleFromListing(listingText || "");
}
// 从 Listing 文案提取「详情页」内容 = 3.2 AEO 结构化五点描述（Bullet Points & Q&A）与
// 3.3 商品详情页内容之间的完整段落（含 Basic Information / Core Selling Points / Q And A / WARM NOTE 等，保留 markdown 结构）。
// 这是店小秘 PC端描述应填的内容（MEMORY：PC 填 3.2 AEO 文案）。与 AI 桥接 extractAeoSection 保持完全一致。
// 兼容两种写法：
//  - 标准包：含「3.2 AEO 结构化五点描述 Bullet Points And Q&A」章节；
//  - 英文批量包（seo_content_only）无「3.2」编号，改用「AEO Structured Bullet Points」起点。
// 终点取下一个 3.x 小节 / Step / 商品详情页 / Product Detail Page 等标记处截断，避免把 3.3 详情页正文也塞进详情页。
function extractDetailLocal(listingText) {
    if (!listingText)
        return "";
    // 1) 定位 AEO 段起点（3.2 编号可选；兼容英文无编号写法）
    const startMatch = listingText.match(
        /(?:3\.2\s*[\s\S]*?)?(?:AEO\s*结构化五点描述|AEO Structured Bullet Points|Bullet Points And Q(?:\s*&\s*|\s+And\s+)A|Bullet Points And Q And A)[\s\S]*?\n/i
    );
    if (!startMatch)
        return "";
    const remainder = listingText.slice(startMatch.index + startMatch[0].length);
    // 2) 定位终点：下一个 3.x 小节 / Step / 商品详情页 / Product Detail Page 等标记
    const endMatch = remainder.match(
        /\n\s*(?:3\.\d+\s+|Step\s+\d+\s*\||#{1,6}\s+3\.\d+|#{1,6}\s+Step\s+\d+|商品详情页内容|商品详情页|Product Detail Page)/i
    );
    const endIndex = endMatch ? endMatch.index : remainder.length;
    const section = remainder.slice(0, endIndex).trim();
    if (section.length >= 30)
        return section;
    return "";
}
async function collectImagesFromDir(baseDir) {
    if (!baseDir)
        return [];
    const found = [];
    // output/ 优先用 AI 生成的 Listing 图（Image_*.png），产品图/ 兜底用 1688 源图（任意图片扩展名）。
    const specs = [
        { sub: "output", re: /^Image_\d+\.(png|jpe?g|webp)$/i },
        { sub: "产品图", re: /\.(png|jpe?g|webp)$/i }
    ];
    for (const { sub, re } of specs) {
        let entries = [];
        try {
            entries = await readdir(path.join(baseDir, sub));
        }
        catch {
            continue;
        }
        for (const name of entries.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
            if (re.test(name))
                found.push(name);
        }
    }
    return found.slice(0, 6);
}
function extractField(text, labels) {
    if (!text)
        return "";
    for (const label of labels) {
        const m = text.match(new RegExp(`${label}[：:]\\s*([^\\n;，。]{1,30})`, "i"));
        if (m && m[1])
            return m[1].trim();
    }
    return "";
}
//# sourceMappingURL=dianxiaomi-facts.js.map
