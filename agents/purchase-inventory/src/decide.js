// agents/purchase-inventory/src/decide.js
// 确定性判定引擎。纯函数：同输入必同输出，不含随机、不含时钟依赖（时间从 asOf 传入）。
//
// 判定顺序严格按 contract.md §3.2 短路，顺序不能换：
//   日切窗口 → 口径缺失 → 口径自洽 → 历史<7天 → DEAD_STOCK → 销速为0 → 覆盖天数

import { AgentError, CODES } from "../../../dist/src/agent-shared/errors.js";

export const VERDICTS = Object.freeze({
  RESTOCK: "RESTOCK",
  WATCH: "WATCH",
  OVERSTOCK: "OVERSTOCK",
  DEAD_STOCK: "DEAD_STOCK",
  NO_HISTORY: "NO_HISTORY",
});

/** 契约里没有对应 E_* 码的拒绝原因，本 Agent 自定义。 */
export const REJECT = Object.freeze({
  DAY_CUT_WINDOW: "DAY_CUT_WINDOW",
  CALIBER_MISSING: "CALIBER_MISSING",
  CALIBER_INCONSISTENT: "CALIBER_INCONSISTENT",
  SELLABLE_CALIBER_USED: "SELLABLE_CALIBER_USED",
  DIMENSION_MIXED: "DIMENSION_MIXED",
  MONEY_OUTPUT_DENIED: "MONEY_OUTPUT_DENIED",
  QUANTITY_LIMIT: "QUANTITY_LIMIT",
  SIDE_EFFECT_EXCEEDED: "SIDE_EFFECT_EXCEEDED",
  GATE_TIMEOUT_PASS: "GATE_TIMEOUT_PASS",
});

export const DEFAULTS = Object.freeze({
  window: 14,
  leadDays: 25,
  safetyDays: 10,
  minOrder: 20,
  overstockDays: 90,
  minHistoryDays: 7,
  deadStockWindowDays: 30,
  deadStockCumulative: 50,
  transitStaleMinutes: 60,
  rejectHours: Object.freeze([15, 16]),
});

/**
 * 覆盖天数计算只允许这三个口径。inventory.sellable 是平台可售额度，
 * 与物理库存差两个数量级（实测 213,682 vs 1,264），一旦混入结论会反转。
 */
export const COVERAGE_BASE_CALIBERS = Object.freeze([
  "inventory.actual",
  "inventory.occupied",
  "inventory.transit",
]);

export const REQUIRED_CALIBERS = Object.freeze([
  ...COVERAGE_BASE_CALIBERS,
  "sales.qty.total",
]);

/** 允许被声明使用（含可选）的全部口径白名单。 */
export const ALLOWED_CALIBERS = Object.freeze([
  ...REQUIRED_CALIBERS,
  "sales.qty.direct",
]);

const HOUR_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  hourCycle: "h23",
});

/** asOf 必须是可解析时间；返回北京小时（0–23）。 */
export function beijingHour(asOf) {
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) {
    throw new AgentError(CODES.INPUT_INVALID, `asOf 不是合法时间：${asOf}`);
  }
  return Number(HOUR_FMT.format(d));
}

function minutesBetween(a, b) {
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  return (t1 - t2) / 60000;
}

/** 主判定：单个 SKU 一条。返回 {verdict, physicalAvailable, dailyVelocity, coverDays, rawSuggestQty, flags, unknowns} */
export function decideOne({
  asOf,
  calibers,
  historyDays,
  cumulativeSalesBefore30d = 0,
  transitCollectedAt = null,
  attemptUse = null,
  params = {},
} = {}) {
  const p = { ...DEFAULTS, ...params };

  // ── 1. 日切窗口：命中即拒，不进入任何计算 ──────────────────
  const hour = beijingHour(asOf);
  if (p.rejectHours.includes(hour)) {
    throw new AgentError(
      REJECT.DAY_CUT_WINDOW,
      `asOf 落在北京时间 ${hour} 点日切窗口（${p.rejectHours.join("/")} 点），平台数据归零，拒绝计算`,
      { asOf, beijingHour: hour, rejectHours: [...p.rejectHours] },
    );
  }

  // ── 2. 必需口径缺失：fail-closed，不许用默认值兜底 ─────────
  const missing = REQUIRED_CALIBERS.filter((k) => !Number.isFinite(calibers?.[k]) || calibers[k] < 0);
  if (missing.length > 0) {
    throw new AgentError(REJECT.CALIBER_MISSING, `必需口径缺失或非法：${missing.join(", ")}`, {
      missing,
      required: [...REQUIRED_CALIBERS],
    });
  }

  // ── 2b. 计算入口的防呆：覆盖基数不许是可售额度 ─────────────
  // 这条不依赖调用方自觉。哪怕未来有人把 sellable 接进来算覆盖天数，这里也拦。
  if (attemptUse === "inventory.sellable") {
    throw new AgentError(
      REJECT.SELLABLE_CALIBER_USED,
      "inventory.sellable 是平台可售额度，不是物理库存，禁止用作覆盖天数基数",
      { attempted: attemptUse, allowed: [...COVERAGE_BASE_CALIBERS] },
    );
  }

  // ── 3. 口径自洽：占用不能超过在库 ────────────────────────
  const actual = calibers["inventory.actual"];
  const occupied = calibers["inventory.occupied"];
  const transit = calibers["inventory.transit"];
  const salesQty = calibers["sales.qty.total"];

  if (occupied > actual) {
    throw new AgentError(
      REJECT.CALIBER_INCONSISTENT,
      `占用（${occupied}）超过在库（${actual}），数据不可信`,
      { actual, occupied },
    );
  }

  const physicalAvailable = actual - occupied + transit;
  const dailyVelocity = salesQty / p.window;
  const leadLine = p.leadDays + p.safetyDays; // 补货线 35 天

  const flags = [];
  if (Number.isFinite(historyDays) && historyDays < p.minHistoryDays) flags.push("HISTORY_TOO_SHORT");
  if (transitCollectedAt) {
    const lag = minutesBetween(asOf, transitCollectedAt);
    if (lag !== null && lag > p.transitStaleMinutes) flags.push("TRANSIT_STALE");
  }
  if (salesQty === 0 && cumulativeSalesBefore30d >= p.deadStockCumulative) {
    flags.push("ZERO_SALES_WITH_HISTORY");
  }

  // ── 4. 历史天数不够：先于任何数量结论 ─────────────────────
  // 顺序很重要：新品 5 天卖 15 件、库存 300，若直接算覆盖天数会得 100 天，
  // 被误判成 OVERSTOCK（积压）。真相是"数据不够，什么都判断不了"。
  if (!Number.isFinite(historyDays) || historyDays < p.minHistoryDays) {
    return {
      verdict: VERDICTS.NO_HISTORY,
      physicalAvailable,
      dailyVelocity,
      coverDays: null,
      rawSuggestQty: 0,
      flags,
      unknowns: [`仅有 ${historyDays ?? 0} 天销售历史，低于 ${p.minHistoryDays} 天门槛`],
      blockers: [],
    };
  }

  // ── 5. DEAD_STOCK：累计卖过但近 30 天零销 ────────────────
  // 只标记，永不产出清仓动作。这形状通常是断货/断码/链接降权。
  if (
    historyDays >= p.deadStockWindowDays &&
    salesQty === 0 &&
    cumulativeSalesBefore30d >= p.deadStockCumulative
  ) {
    return {
      verdict: VERDICTS.DEAD_STOCK,
      physicalAvailable,
      dailyVelocity: 0,
      coverDays: null,
      rawSuggestQty: 0,
      flags: [...new Set([...flags, "ZERO_SALES_WITH_HISTORY"])],
      unknowns: [],
      blockers: [],
      cumulativeSalesBefore30d,
    };
  }

  // ── 6. 销速为 0 且累计不足：无历史可依 ───────────────────
  if (dailyVelocity === 0) {
    return {
      verdict: VERDICTS.NO_HISTORY,
      physicalAvailable,
      dailyVelocity: 0,
      coverDays: null,
      rawSuggestQty: 0,
      flags,
      unknowns: ["日均销速为 0，无法推算覆盖天数"],
      blockers: [],
    };
  }

  // ── 7. 覆盖天数三档，必须无缝覆盖 ───────────────────────
  const coverDays = physicalAvailable / dailyVelocity;
  const rawSuggestQty = Math.ceil(dailyVelocity * leadLine - physicalAvailable);
  const unknowns = [];
  if (flags.includes("TRANSIT_STALE")) {
    unknowns.push("在途数据滞后，实际可补量可能更少");
  }

  let verdict;
  if (coverDays > p.overstockDays) {
    verdict = VERDICTS.OVERSTOCK;
  } else if (coverDays < leadLine) {
    verdict = rawSuggestQty >= p.minOrder ? VERDICTS.RESTOCK : VERDICTS.WATCH;
    if (verdict === VERDICTS.WATCH) unknowns.push(`建议补货 ${Math.max(rawSuggestQty, 0)} 件，未达最少起补 ${p.minOrder} 件`);
  } else {
    verdict = VERDICTS.WATCH; // 覆盖天数落在 [补货线, 90]
  }

  return {
    verdict,
    physicalAvailable,
    dailyVelocity,
    coverDays,
    rawSuggestQty,
    flags,
    unknowns,
    blockers: [],
  };
}
