// ecom-translator → 一跨而境 契约转换器（纯函数，不碰 fs）
// 依据 docs/CONTRACT_MAP_ecom.md 与真实样例：
//   ecom: output/<分类>/<产品>/product_info.json(schema 3) + listing_handoff.json(schema 1)
//   目标: 一跨而境 product-facts.json (schemaVersion 1.0)
//
// 铁律：
// 1. 不补写事实：gaps_and_conflicts / quality / conflicts 必须进 meta.provenance；
// 2. 未知轴向不组合：dimensions 三维不全 → dimensionsCm 留空；
// 3. 复核态不放行：delivery_gate.review_required=true → provenance.reviewRequired=true。

function toText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return String(value.text ?? value.value ?? "").trim();
}

export function pickValue(list) {
    if (!Array.isArray(list)) return null;
    for (const entry of list) {
        const text = toText(entry);
        if (text) return text;
    }
    return null;
}

export function pickValues(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map(toText).filter(Boolean))];
}

/** "20cm" / "200mm" / "0.2m" → 厘米数值；无法解析返回 null。 */
export function parseLengthCm(raw) {
    const match = String(raw ?? "").match(/(\d+(?:\.\d+)?)\s*(cm|mm|m)\b/i);
    if (!match) return null;
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(value)) return null;
    return unit === "mm" ? value / 10 : unit === "m" ? value * 100 : value;
}

/**
 * 仅当 length/width/height 三轴都被明确确认时才组合；否则返回 {}。
 * ecom 的 dims 常是「文字标注 20cm + axis=unknown」，组合即造假。
 */
export function toDimensionsCm(entries) {
    const axes = {};
    for (const entry of Array.isArray(entries) ? entries : []) {
        const axis = String(entry?.axis ?? "").toLowerCase();
        if (!["length", "width", "height"].includes(axis)) continue;
        if (axes[axis] != null) continue;
        const cm = parseLengthCm(entry?.value ?? entry?.source_text);
        if (cm != null) axes[axis] = cm;
    }
    if (Object.keys(axes).length !== 3) return {};
    return { length: axes.length, width: axes.width, height: axes.height };
}

/** 收集 SUCCESS 的图片：优先译图，否则原图；返回 [{name, ecomPath, kind}]。 */
export function collectImageAssets(handoff = {}) {
    const assets = Array.isArray(handoff.image_assets) ? handoff.image_assets : [];
    const out = [];
    for (const asset of assets) {
        if (asset?.status && asset.status !== "SUCCESS") continue;
        const translated = asset?.translated_image || "";
        const source = asset?.source_image || "";
        // 源图与译图都要：源图进 产品图/，译图进 output/
        if (source) out.push({ name: source.split(/[\\/]/).pop(), ecomPath: source, kind: "source" });
        if (translated) out.push({ name: translated.split(/[\\/]/).pop(), ecomPath: translated, kind: "translated" });
    }
    return out;
}

export function toYikuaborderFacts(info = {}, handoff = {}) {
    const spec = info.specifications ?? {};
    const verifiedSpec = handoff.verified_facts?.specifications ?? {};
    const quality = info.quality ?? {};
    const gate = handoff.delivery_gate ?? {};
    const folder = info.product?.folder || handoff.product?.task_folder || "";
    const imageAssets = collectImageAssets(handoff);
    const packageContents = pickValues(spec.package_contents ?? verifiedSpec.package_contents ?? []);
    const sellingPoints = (handoff.evidence_backed_selling_points ?? []).map(toText).filter(Boolean);
    const reviewRequired = Boolean(gate.review_required) || (quality.status && quality.status !== "READY");

    return {
        schemaVersion: "1.0",
        productId: folder,
        title: { zh: "", en: "" },
        category: pickValue(info.product_type ?? []) || "",
        brand: null,
        material: pickValue(spec.material ?? verifiedSpec.material ?? []),
        origin: {},
        keyAttributes: [...new Set([...sellingPoints, ...packageContents])],
        variants: {
            dimensions: [],
            skus: [],
            matrix: [],
            colors: [],
            sizes: [],
            defaultPrice: "",
            defaultStock: "",
            defaultWeight: "",
            colorImages: {},
            colorCustomNames: {}
        },
        images: {
            // 主图优先用译图；没有译图才退回源图
            main: (() => {
                const translated = imageAssets.filter((a) => a.kind === "translated").map((a) => a.name);
                return translated.length ? translated : imageAssets.filter((a) => a.kind === "source").map((a) => a.name);
            })()
        },
        unit: "piece",
        originalBox: packageContents.length ? packageContents.join("; ") : null,
        weight: pickValue(spec.weight ?? verifiedSpec.weight ?? []),
        dimensionsCm: toDimensionsCm(spec.dimensions ?? verifiedSpec.dimensions ?? []),
        description: { pc: "", mobile: "" },
        hsCode: "",
        compliance: {},
        sourceUrl: "",
        mainKeyword: "",
        meta: {
            provenance: {
                source: "ecom-translator",
                ecomFolder: folder,
                qualityStatus: quality.status ?? null,
                reviewRequired,
                gaps: Array.isArray(info.gaps_and_conflicts) ? info.gaps_and_conflicts : [],
                conflicts: Array.isArray(info.conflicts) ? info.conflicts : [],
                missingFields: Array.isArray(quality.missing_fields) ? quality.missing_fields : [],
                measurementEvidenceCount: quality.measurement_evidence_count ?? 0,
                // 不在此处写 importedAt：facts 必须确定性，否则幂等/冲突的内容比对失效。
                // 导入时间记录在 ecom-handoff.json（manifest）里。
                imageAssets
            }
        }
    };
}
