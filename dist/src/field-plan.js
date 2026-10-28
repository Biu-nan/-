// field_plan.json 消费器 —— 把 ecom 已产出的 ERP 计划读进来，供一跨执行。
//
// 为什么是「消费」不是「重造」：
//   ecom 的 ERP_PLAN 阶段已经把五元组字段计划、SKU 计划、描述计划算完并落在
//   产品包的 erp/field_plan.json 里（实测 320 个包 100% 都有，schema v7 占 311）。
//   一跨再从零实现一遍计划层，等于造第二套真相 —— 两边一旦算法漂移就无法对账。
//
// 七态 action（实测 320 包共 6076 条，全部出现过）：
//   DISCOVER_ON_PAGE   2885   页面上现找，计划里不给值
//   FILL               1148   直接填计划里的值
//   PRESERVE_OR_VERIFY  960   保持现有值并验证（引用模板带出的，别覆盖）
//   REVIEW              536   需人工复核 —— **程序不得自动填**
//   SKIP                331   明确跳过
//   FILL_WITH_REVIEW    215   填，但填完要人工看
//   MISSING_SOURCE        1   源缺失，不可填
//
// 本模块只做纯数据转换，不碰浏览器、不发请求。

export const FIELD_PLAN_SUPPORTED_VERSIONS = [7];

const ACTION_GROUPS = {
  DISCOVER_ON_PAGE: "discover",
  FILL: "fill",
  PRESERVE_OR_VERIFY: "preserve",
  REVIEW: "review",
  SKIP: "skip",
  FILL_WITH_REVIEW: "fillWithReview",
  MISSING_SOURCE: "missing",
};

/** 读并校验一份 field_plan.json。pkgDir 是产品包目录（其下有 erp/field_plan.json）。 */
export function normalizeFieldPlan(raw) {
  const problems = [];
  const plan = raw && typeof raw === "object" ? raw : null;
  if (!plan) return { ok: false, plan: null, problems: ["field_plan 为空或非对象"] };

  const version = Number(plan.schema_version);
  if (!Number.isFinite(version)) problems.push("缺少 schema_version");
  else if (!FIELD_PLAN_SUPPORTED_VERSIONS.includes(version)) {
    // 不直接判失败：先放行并标注，让上层决定是否接受。
    problems.push(`schema_version=${version} 未在支持列表 ${JSON.stringify(FIELD_PLAN_SUPPORTED_VERSIONS)} 内`);
  }

  if (!Array.isArray(plan.field_plan)) problems.push("field_plan 字段列表缺失");
  if (!plan.sku_plan || typeof plan.sku_plan !== "object") problems.push("sku_plan 缺失");

  const blockers = Array.isArray(plan.blockers) ? plan.blockers : [];
  if (blockers.length) problems.push(`存在 ${blockers.length} 条 blockers，不可直接执行`);

  return { ok: problems.length === 0, plan, problems, version, blockers };
}

/** 把 19 个字段按 action 分组。返回每一组的字段原文（保留 label/value/source 便于溯源）。 */
export function groupFields(plan) {
  const groups = { discover: [], fill: [], preserve: [], review: [], skip: [], fillWithReview: [], missing: [], unknown: [] };
  const fields = Array.isArray(plan && plan.field_plan) ? plan.field_plan : [];
  for (const f of fields) {
    const key = ACTION_GROUPS[String(f && f.action || "").trim()] || "unknown";
    groups[key].push(f);
  }
  return { groups, total: fields.length };
}

/**
 * SKU 计划 → 引擎可用的变种行。
 *
 * 映射依据（逐字段对照 write_rows 实际结构，不猜）：
 *   supply_price          → price      （注意：不是 rows[].supply_price，那是源价 13.50；
 *                                        write_rows 里是按规则算过的 22.35）
 *   inventory             → stock      （同理，write_rows 里是按 inventory_rule 重算的 50，
 *                                        不是源库存 49369）
 *   package.weight_kg     → weight
 *   sku_code              → sku
 *   custom_name           → customName （已翻译的英文自定义名）
 *   color_selection_order → 保留，供页面按顺序勾选颜色
 *
 * 不产出 combination 的第二维（尺寸）：箱包挂件这类没有尺寸维度，
 * 强行编一个 "One Size" 会让页面去匹配一个不存在的选项。
 */
export function planToVariantRows(plan) {
  const writeRows = plan && plan.sku_plan && Array.isArray(plan.sku_plan.write_rows)
    ? plan.sku_plan.write_rows
    : [];
  const problems = [];
  const rows = [];

  for (const r of writeRows) {
    const price = Number(r.supply_price);
    const stock = Number(r.inventory);
    const weight = Number((r.package && r.package.weight_kg) || 0);
    if (!Number.isFinite(price) || price <= 0) problems.push(`行 ${r.source_row_number}: 供货价无效 (${r.supply_price})`);
    if (!Number.isFinite(stock)) problems.push(`行 ${r.source_row_number}: 库存无效 (${r.inventory})`);
    if (!r.sku_code) problems.push(`行 ${r.source_row_number}: 缺 sku_code`);

    rows.push({
      sourceRowNumber: r.source_row_number,
      sourceSkuId: r.source_sku_id,
      sourceCustomName: r.source_custom_name,
      customName: r.custom_name || "",
      colorSelectionOrder: Number(r.color_selection_order) || null,
      skuCode: r.sku_code || "",
      price: Number.isFinite(price) ? price : 0,
      stock: Number.isFinite(stock) ? stock : 0,
      weight: Number.isFinite(weight) ? weight : 0,
      currency: r.currency || "CNY",
      warehouse: r.warehouse || "",
      image: r.sku_image_url || "",
      needsHumanReview: r.custom_name_requires_human_review === true,
    });
  }

  return { rows, problems };
}

/**
 * 把一组字段计划转换成「程序可以自己填」的键值对。
 * 只取 FILL；FILL_WITH_REVIEW 单独返回（能填但要人工看）；REVIEW/DISCOVER/SKIP/MISSING 一律不填。
 */
export function planToFillValues(plan) {
  const { groups } = groupFields(plan);
  const pick = (list) => list.map((f) => ({
    label: f.label,
    value: f.value,
    source: f.source || "",
    evidenceIds: f.evidence_ids || [],
    reason: f.reason || "",
  }));
  return {
    fill: pick(groups.fill),
    fillWithReview: pick(groups.fillWithReview),
    // 下列三组**故意只返回 label**，不返回 value：
    // REVIEW 的值即使存在也不可信（可能是 AI 猜的），DISCOVER 本来就没有值，
    // SKIP 的值存在但不该写。返回 label 是为了让上层能把它们呈给人工。
    reviewLabels: groups.review.map((f) => ({ label: f.label, reason: f.reason || "" })),
    discoverLabels: groups.discover.map((f) => ({ label: f.label, reason: f.reason || "" })),
    skipLabels: groups.skip.map((f) => ({ label: f.label, reason: f.reason || "" })),
    missing: groups.missing.map((f) => ({ label: f.label, reason: f.reason || "" })),
    unknown: groups.unknown.map((f) => ({ label: f.label, action: f.action })),
  };
}
