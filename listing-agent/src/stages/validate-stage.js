// Stage 3 · VALIDATE（质量校验 + 完整性）：三层校验并产出「缺项清单」供自纠错。
// 复用 dist/src/product-fact-service.js 的 ajv 校验与 knowledge 里的乳贴字段规范。
import { ProductFactService } from "../../../dist/src/product-fact-service.js";
import { requiredFactLabels } from "../knowledge/field-spec.js";
import { getRequiredAttrDefaults } from "../knowledge/profiles.js";

const factService = new ProductFactService();

/**
 * 在 facts.keyAttributes 中按标签（部分匹配）查找属性值。
 * @param {object} facts
 * @param {string} label
 * @returns {string|null}
 */
function findAttr(facts, label) {
  const list = (facts.keyAttributes || []).filter((a) => a && (a.name || "").includes(label));
  return list.length ? list[0].value : null;
}

/**
 * 校验 facts 的完整性 / schema / 质量，并返回结构化缺项（含是否可自纠错、默认值）。
 * @param {object} args
 * @param {object} args.facts
 * @param {object} args.profile 类目 profile
 * @returns {Promise<{report:object, missing:Array}>}
 */
export async function validateStage({ facts, profile }) {
  const { valid, errors } = await factService.validate(facts);

  // schema 语义放宽（与线上一致）：normalizeDianxiaomiFacts 会写入 variants.matrix/colors/sizes 等
  // 「适配端元数据」字段，而 product-fact.schema.json 的 variants 是 additionalProperties:false 仅声明
  // dimensions/skus。线上系统本就容忍这种差异（写盘后由店小秘 adapter 直接读字段，不经 ajv 门禁）。
  // 因此只对「非 additionalProperties」的硬错误（类型错、必填缺失）判失败；纯多余字段降级为警告。
  const hardErrors = (errors || []).filter((e) => e.keyword !== "additionalProperties");
  const additionalWarnings = (errors || [])
    .filter((e) => e.keyword === "additionalProperties")
    .map((e) => `${e.instancePath || "/"} ${e.message}`);
  const schemaValid = hardErrors.length === 0;

  const missing = [];

  // ① 基础三项（来自 checkDianxiaomiFactsReady 范式）
  const hasTitle = !!(facts.title && (facts.title.zh || facts.title.en));
  if (!hasTitle) missing.push({ kind: "title", label: "标题(title)", fixable: true });
  const desc = facts.description;
  const hasDesc = !!(desc && (desc.pc || desc.mobile));
  if (!hasDesc) missing.push({ kind: "desc", label: "详情页(description)", fixable: true });
  const imgs = (facts.images && Array.isArray(facts.images.main)) ? facts.images.main : [];
  if (!imgs.length) missing.push({ kind: "image", label: "主图(images.main)", fixable: false });

  // ② 类目 requiredAttrs（默认值可自纠错）
  const defaults = getRequiredAttrDefaults(profile);
  for (const a of defaults) {
    const val = findAttr(facts, a.label) || (facts.compliance && facts.compliance[a.label]);
    if (!val) missing.push({ kind: "requiredAttr", label: a.label, fixable: true, defaultValue: a.value });
  }

  // ③ 乳贴业务必填字段规范（仅乳贴类目生效；通用/箱包/包挂不套用，避免误报）
  if (profile && profile.key === "ruTie") {
    for (const label of requiredFactLabels()) {
    if (["产品标题", "详情页", "产品图片", "PC端描述"].includes(label)) continue; // 已由 ① 覆盖
    let ok = true;
    if (label === "产品分类") ok = !!facts.category;
    else if (label === "尺寸(Size)") {
      const dims = (facts.variants && Array.isArray(facts.variants.dimensions)) ? facts.variants.dimensions : [];
      const hasSizeDim = dims.some((d) => /尺寸|尺码|大小|规格/.test(d));
      const hasSkus = (facts.variants && Array.isArray(facts.variants.skus)) ? facts.variants.skus.length > 0 : false;
      ok = hasSizeDim || hasSkus;
    } else if (label === "计件单位") ok = !!facts.unit;
    else if (label === "海关监管属性") ok = !!(facts.hsCode || (facts.compliance && facts.compliance.customsAttribute));
    if (!ok) missing.push({ kind: "factLabel", label, fixable: label === "计件单位" || label === "海关监管属性" });
    }
  }

  const blockers = [
    ...hardErrors.map(e => ({ code: "SCHEMA_INVALID", path: e.instancePath || "/", message: e.message, fixable: false })),
    ...missing.map(m => ({ code: "MISSING_FIELD", message: m.label, fixable: m.fixable })),
  ];
  const reviewRequired = facts.meta?.provenance?.reviewRequired;
  if (reviewRequired !== undefined && reviewRequired !== false) {
    blockers.push({ code: "SOURCE_REVIEW_REQUIRED", path: "/meta/provenance/reviewRequired", message: "来源资料尚需人工复核", fixable: false });
  }
  const qualityScore = computeQuality(facts, missing);
  // 所有缺项（含可自纠错的）清零 + 无 schema 硬错误，才算通过；否则交由自纠错循环处理。
  const ok = schemaValid && blockers.length === 0;

  const report = {
    schemaValid,
    schemaErrors: errors || [],
    completeness: {
      ok,
      missing: missing.map((m) => m.label),
      requiredByProfile: defaults.map((d) => d.label),
    },
    qualityScore,
    warnings: additionalWarnings,
    blockers,
  };

  return { report, missing };
}

function computeQuality(facts, missing) {
  let score = 0;
  if (facts.title && (facts.title.zh || facts.title.en)) score += 20;
  const desc = facts.description;
  if (desc && (desc.pc || desc.mobile)) score += 20;
  const imgs = (facts.images && Array.isArray(facts.images.main)) ? facts.images.main : [];
  if (imgs.length >= 1) score += 20;
  if ((facts.keyAttributes || []).length >= 3) score += 15;
  const skus = (facts.variants && Array.isArray(facts.variants.skus)) ? facts.variants.skus : [];
  if (skus.length > 0) score += 15;
  if (facts.category) score += 10;
  return Math.min(100, score);
}
