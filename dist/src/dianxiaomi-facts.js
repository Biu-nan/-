import { DIANXIAOMI_TEMPLATE_PRODUCT_ID } from "./config.js";
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
//# sourceMappingURL=dianxiaomi-facts.js.map
