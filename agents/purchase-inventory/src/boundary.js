// agents/purchase-inventory/src/boundary.js
// 六条红线的代码实现。对应 prompts/03_boundary_check.md，但**不依赖模型执行**。
//
// 设计原则：pass=false 时整批丢弃，不允许"只删违规那一条、其余照发"。
// 一次越权说明这批的生成路径已经出问题，剩下的也不可信。

import { REJECT } from "./decide.js";
import { isHollowReason } from "./reason.js";

const MONEY_KEY = /(amount|price|cost|margin|gmv|roi|currency|money|fee|profit)/i;
const MONEY_SYMBOL = /[¥$€£]|￥/;
const WRITE_INTENT = /(writeToPlatform|publish|delete|remove|priceChange|updateStock|pushToDianxiaomi|batchApply|adjustPrice)/i;

function walkKeys(value, visit, keyPath = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkKeys(item, visit, `${keyPath}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      visit(k, v, `${keyPath}.${k}`);
      walkKeys(v, visit, `${keyPath}.${k}`);
    }
  }
}

/**
 * 检查一批输出是否越过红线。
 * @param {object} batch  完整输出批次
 * @param {object} limits 读自 config/limits.json
 * @returns {{pass:boolean, violations:Array, warnings:Array}}
 */
export function checkBoundary(batch, limits) {
  const violations = [];
  const warnings = [];
  const add = (code, where, detail) => violations.push({ code, where, detail });

  // ── 1. 金额：任何层级出现金额字段或货币符号，整批作废 ──────────
  walkKeys(batch, (key, value, path) => {
    if (MONEY_KEY.test(key)) {
      add(REJECT.MONEY_OUTPUT_DENIED, path, `出现金额类字段名 ${key}`);
    } else if (typeof value === "string" && MONEY_SYMBOL.test(value)) {
      add(REJECT.MONEY_OUTPUT_DENIED, path, `字符串里出现货币符号`);
    }
  });

  // ── 2. 可售库存入算 ────────────────────────────────────────
  const used = Array.isArray(batch.calibersUsed) ? batch.calibersUsed : [];
  if (used.includes("inventory.sellable")) {
    add(REJECT.SELLABLE_CALIBER_USED, "$.calibersUsed", "inventory.sellable 是平台可售额度，不是物理库存");
  }

  // ── 3. 量纲混用 ────────────────────────────────────────────
  if (used.includes("conv.buyers")) {
    add(REJECT.DIMENSION_MIXED, "$.calibersUsed", "conv.buyers 量纲是订单/买家，不是件数");
  }
  if (batch.quantityDim && batch.quantityDim !== "件") {
    add(REJECT.DIMENSION_MIXED, "$.quantityDim", `数量量纲必须是「件」，实际 ${batch.quantityDim}`);
  }

  // ── 4. 数量超限（检查拆分后的最终单，不是 rawSuggestQty）──────
  const items = Array.isArray(batch.items) ? batch.items : [];
  const maxPerSku = limits?.quantity?.maxSuggestPerSku ?? 500;
  const maxTotal = limits?.quantity?.maxTotalPerOrder ?? 2000;
  const maxSkus = limits?.quantity?.maxSkusPerRun ?? 50;

  if (items.length > maxSkus) {
    add(REJECT.QUANTITY_LIMIT, "$.items", `SKU 数 ${items.length} 超过单次上限 ${maxSkus}`);
  }
  let total = 0;
  items.forEach((it, i) => {
    const q = Number(it?.suggestQty ?? 0);
    total += q;
    if (q > maxPerSku) {
      add(REJECT.QUANTITY_LIMIT, `$.items[${i}].suggestQty`, `${q} 件超过单 SKU 上限 ${maxPerSku}`);
    }
  });
  if (total > maxTotal) {
    add(REJECT.QUANTITY_LIMIT, "$.items", `批次合计 ${total} 件超过上限 ${maxTotal}`);
  }

  // ── 5. 越级副作用 ─────────────────────────────────────────
  walkKeys(batch, (key, value, path) => {
    if (WRITE_INTENT.test(key)) {
      add(REJECT.SIDE_EFFECT_EXCEEDED, path, `出现写平台/发布/删除类字段 ${key}`);
    }
    if (key === "sideEffect" && typeof value === "string" && !["P0", "P1"].includes(value)) {
      add(REJECT.SIDE_EFFECT_EXCEEDED, path, `副作用等级 ${value} 超出本 Agent 允许的 P0/P1`);
    }
  });

  // ── 6. Gate 超时放行 ──────────────────────────────────────
  if (batch.gate) {
    if (batch.gate.defaultIfIgnored !== "stall") {
      add(REJECT.GATE_TIMEOUT_PASS, "$.gate.defaultIfIgnored", `只允许 stall，实际 ${batch.gate.defaultIfIgnored}`);
    }
    if (batch.gate.allowTimeoutPass === true) {
      add(REJECT.GATE_TIMEOUT_PASS, "$.gate.allowTimeoutPass", "拒绝一切超时放行");
    }
  }

  // ── 软检查：不阻断，但记账 ─────────────────────────────────
  items.forEach((it, i) => {
    if (isHollowReason(it?.reason)) {
      warnings.push({ code: "REASON_HOLLOW", where: `$.items[${i}].reason` });
    }
    const unknownCount = Array.isArray(it?.unknowns) ? it.unknowns.length : 0;
    const reason = String(it?.reason ?? "");
    const hasQualifier = /（|滞后|可能|未知|不足|待查/.test(reason);
    if (unknownCount > 0 && !hasQualifier) {
      warnings.push({ code: "UNKNOWN_SWALLOWED", where: `$.items[${i}].reason` });
    }
  });

  return { pass: violations.length === 0, violations, warnings };
}
