// Stage 1 · PARSE（信息解析）：把任意输入形态归一化为 ProductFacts 草稿。
// 复用 dist/src/dianxiaomi-facts.js 的 normalizeDianxiaomiFacts 与 product-fact-service.js 的 parseAi。
import { normalizeDianxiaomiFacts } from "../../../dist/src/dianxiaomi-facts.js";
import { ProductFactService } from "../../../dist/src/product-fact-service.js";
import { deepMerge } from "../util.js";

const factService = new ProductFactService();

/**
 * 解析请求输入为归一化 facts 草稿（可能不完整）。
 * @param {object} args
 * @param {object} args.request 归一化后的 ListingRequest
 * @param {object} args.profile 类目 profile
 * @returns {object} facts 草稿
 */
export function parseStage({ request, profile }) {
  const { input } = request;
  let raw = {};

  if (input.factsJson && typeof input.factsJson === "object") {
    raw = input.factsJson;
  } else if (input.factsMarkdown) {
    try {
      raw = factService.parseAi(input.factsMarkdown);
    } catch {
      raw = {};
    }
  }
  // images / sourceUrl / hybrid(无 factsJson) 类型：暂以空壳进入 generate 阶段由 AI 补全。

  let facts = normalizeDianxiaomiFacts(raw);

  // 合并人工覆盖项
  if (input.overrides && typeof input.overrides === "object") {
    facts = deepMerge(facts, input.overrides);
  }

  // 类目兜底：若 facts 无 category 且 profile 有默认类目
  if (!facts.category && profile && profile.category) {
    facts.category = profile.category;
  }

  return facts;
}
