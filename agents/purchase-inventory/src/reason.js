// agents/purchase-inventory/src/reason.js
// 理由生成：默认确定性模板，不调模型。
//
// 为什么不靠模型写理由：
//   ① 测试要可复现——模型输出不稳定，断言会飘；
//   ② 理由里的数字必须只来自已算好的结果，模型容易自己编一个；
//   ③ prompts/02_reason_writer.md 仍然保留，供人读/调优措辞，但代码走模板兜底。
// 需要模型润色时，由调用方传入 writer 覆盖，且必须过 boundary 的红线检查。

const fmtDays = (v) => {
  if (!Number.isFinite(v)) return "未知";
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};
const fmtQty = (v) => String(Math.max(0, Math.round(v)));

function withUnknowns(text, unknowns) {
  const list = (unknowns ?? []).filter(Boolean);
  if (list.length === 0) return text;
  return `${text}（${list.join("；")}）`;
}

/**
 * 生成一句可直接做决定的话。
 * @param {object} r  decideOne() 的返回值
 * @param {object} ctx { leadLine, minOrder, minHistoryDays, deadStockCumulative }
 */
export function buildReason(r, ctx = {}) {
  const leadLine = ctx.leadLine ?? 35;
  const minOrder = ctx.minOrder ?? 20;
  const minHistoryDays = ctx.minHistoryDays ?? 7;

  switch (r.verdict) {
    case "RESTOCK":
      return withUnknowns(
        `覆盖只剩 ${fmtDays(r.coverDays)} 天（补货线 ${leadLine} 天），建议补 ${fmtQty(r.rawSuggestQty)} 件`,
        r.unknowns,
      );

    case "WATCH":
      // 两种情况：未到补货线的临界，或已有较多库存但没到积压
      if (Number.isFinite(r.coverDays) && r.coverDays < leadLine) {
        return withUnknowns(
          `覆盖 ${fmtDays(r.coverDays)} 天，低于补货线但建议量未达起补 ${minOrder} 件，先观察`,
          r.unknowns,
        );
      }
      return withUnknowns(
        `覆盖 ${fmtDays(r.coverDays)} 天，未到补货线，暂不处理`,
        r.unknowns,
      );

    case "OVERSTOCK":
      return withUnknowns(`覆盖 ${fmtDays(r.coverDays)} 天，库存偏高，暂不处理`, r.unknowns);

    case "DEAD_STOCK":
      // 措辞关键：必须写成「待查」，不能写成「要清」。
      // 累计卖过 174 件却 30 天零销，这形状通常是断货/断码/链接降权，不是长尾。
      return `累计卖过 ${fmtQty(r.cumulativeSalesBefore30d ?? 0)} 件、近 30 天零销，需人工核查是否断货/断码/降权`;

    case "NO_HISTORY":
      if (r.flags?.includes("HISTORY_TOO_SHORT")) {
        return `销售历史不足 ${minHistoryDays} 天，无法判断趋势，需人判断`;
      }
      return `无销售记录，销售历史不足以判断趋势，需人判断`;

    default:
      // 未知结论绝不静默放行
      return `结论未知（${r.verdict ?? "undefined"}），需人判断`;
  }
}

/** 理由空洞检测：全角/半角字符都算，少于 8 个中文字即视为空洞。 */
export function isHollowReason(text) {
  const cjk = (String(text ?? "").match(/[\u4e00-\u9fa5]/g) ?? []).length;
  return cjk < 8;
}
