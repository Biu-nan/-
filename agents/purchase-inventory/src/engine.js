// agents/purchase-inventory/src/engine.js
// 单次评估的核心编排：判定 → 拆单 → 组装批次 → 过红线。
// 从 cli.js 抽出，因为 workflow.js 要复用，而 cli.js 顶层会执行 main() 不能被 import。

import { decideOne, DEFAULTS, VERDICTS, REQUIRED_CALIBERS } from "./decide.js";
import { buildReason } from "./reason.js";
import { checkBoundary } from "./boundary.js";
import { splitQuantity } from "./limits.js";

/**
 * 跑一条输入，产出可直接交付的批次，或一个明确的拒绝。
 * @param {object} input 见 evals/cases.json 的 input 形状
 * @param {object} limits config/limits.json
 */
export async function runOne(input, limits) {
  const p = { ...DEFAULTS, ...(input.params ?? {}) };
  const leadLine = p.leadDays + p.safetyDays;
  const maxPerSku = limits.quantity.maxSuggestPerSku;

  let decided;
  try {
    decided = decideOne({
      asOf: input.asOf,
      calibers: input.calibers,
      historyDays: input.historyDays,
      cumulativeSalesBefore30d: input.cumulativeSalesBefore30d ?? 0,
      transitCollectedAt: input.transitCollectedAt ?? null,
      attemptUse: input.attemptUse ?? null,
      params: input.params ?? {},
    });
  } catch (e) {
    const code = e.code ?? "UNKNOWN";
    return {
      status: "REJECTED",
      code,
      missing: e.details?.missing ?? [],
      verdict: null,
      wholeBatchDiscarded: true,
      violations: [{ code, where: "$", detail: e.message }],
      warnings: [],
    };
  }

  const reason = buildReason(decided, {
    leadLine,
    minOrder: p.minOrder,
    minHistoryDays: p.minHistoryDays,
    deadStockCumulative: p.deadStockCumulative,
  });

  // 只有 RESTOCK 才产生数量；其余结论一律 0 件
  const split =
    decided.verdict === VERDICTS.RESTOCK
      ? splitQuantity(decided.rawSuggestQty, maxPerSku)
      : { orders: [0], splitInto: 0 };

  // 超单 SKU 上限就必须拆单并要求逐单确认——这个信号必须写进输出，
  // 不能只在内部知道。下游看不到就等于没发生。
  const onViolation = split.splitInto > 1 ? "SPLIT_AND_REQUIRE_HUMAN" : null;

  const items = split.orders.map((qty, i) => ({
    skuId: input.skuId ?? "SKU-PLACEHOLDER",
    orderIndex: i,
    verdict: decided.verdict,
    physicalAvailable: decided.physicalAvailable,
    dailyVelocity: decided.dailyVelocity,
    coverDays: decided.coverDays,
    suggestQty: qty,
    reason,
    unknowns: decided.unknowns ?? [],
  }));

  const calibersUsed = REQUIRED_CALIBERS.filter((k) => k in (input.calibers ?? {}));
  if ("sales.qty.direct" in (input.calibers ?? {})) calibersUsed.push("sales.qty.direct");

  const summary = { restock: 0, watch: 0, overstock: 0, deadStock: 0, noHistory: 0 };
  const key = {
    RESTOCK: "restock",
    WATCH: "watch",
    OVERSTOCK: "overstock",
    DEAD_STOCK: "deadStock",
    NO_HISTORY: "noHistory",
  }[decided.verdict];
  if (key) summary[key] = 1;

  const batch = {
    schema: "purchase-inventory/suggestion/v1",
    storeId: input.storeId ?? "400370",
    asOf: input.asOf,
    quantityDim: "件",
    calibersUsed,
    calibersMissing: [],
    splitInto: split.splitInto,
    onViolation,
    params: {
      window: p.window,
      leadDays: p.leadDays,
      safetyDays: p.safetyDays,
      minOrder: p.minOrder,
    },
    items,
    summary,
    gate: {
      required: decided.verdict === VERDICTS.RESTOCK,
      question: `建议补货 ${Math.max(0, decided.rawSuggestQty)} 件，确认下单？`,
      defaultIfIgnored: "stall",
    },
  };

  // 模拟"有人往批次里塞了不该塞的字段"，用于验证红线真的拦得住
  if (input.injected) Object.assign(batch.items[0], input.injected);

  const b = checkBoundary(batch, limits);
  if (!b.pass) {
    return {
      status: "REJECTED",
      code: b.violations[0].code,
      missing: [],
      verdict: null,
      wholeBatchDiscarded: true,
      violations: b.violations,
      warnings: b.warnings,
    };
  }

  return {
    status: "OK",
    code: null,
    verdict: decided.verdict,
    physicalAvailable: decided.physicalAvailable,
    dailyVelocity: decided.dailyVelocity,
    coverDays: decided.coverDays,
    rawSuggestQty: decided.rawSuggestQty,
    suggestQty: items[0].suggestQty,
    splitInto: split.splitInto,
    eachOrderMax: Math.max(0, ...split.orders),
    onViolation,
    flags: decided.flags ?? [],
    reason,
    unknowns: decided.unknowns ?? [],
    gate: batch.gate,
    calibersUsed,
    wholeBatchDiscarded: false,
    violations: [],
    warnings: b.warnings,
    batch,
  };
}
