// 类目知识单一真相（agent 侧门面）。从 dist/src/listing-knowledge.js 导入，独立部署时随包携带。
import {
  DIANXIAOMI_CATEGORY_PROFILES,
  getDianxiaomiProfile,
  isXiangBaoProfile,
  MODEL_PROFILES,
  resolveModelProfile,
  DIANXIAOMI_DEFAULT_PROFILE_KEY,
  PRODUCT_FACTS_STRUCTURE_PROMPT,
} from "../../../dist/src/listing-knowledge.js";

export {
  DIANXIAOMI_CATEGORY_PROFILES,
  getDianxiaomiProfile,
  isXiangBaoProfile,
  MODEL_PROFILES,
  resolveModelProfile,
  DIANXIAOMI_DEFAULT_PROFILE_KEY,
  PRODUCT_FACTS_STRUCTURE_PROMPT,
};

/**
 * 通用/其他类目键。用于「auto 无法命中已知三系（乳贴/箱包/包挂）」时的回落，
 * 而不是错误地回落到默认的 ruTie（乳贴）。
 */
export const GENERIC_PROFILE_KEY = "generic";

/**
 * 通用产品事实提取 prompt：适用于任何非乳贴/箱包/包挂的消费品（如 3C 配件、
 * 家居、工具等）。不强制乳贴专属字段，只产出标准电商事实。
 */
const GENERIC_EXTRACT_PROMPT = `# 跨境电商产品事实提取（通用类目）
你是一名速卖通 / 店小秘 产品信息提取专家。请基于产品图与可见信息，提取标准电商产品事实。
仅输出一个 JSON 代码块，形状如下：
{
  "title": { "zh": "中文标题（含核心关键词+差异化卖点+关键属性）", "en": "英文标题" },
  "description": { "pc": "PC 端详情（结构化：核心卖点 / 规格参数 / Q&A / 温馨提示）", "mobile": "移动端详情" },
  "category": "平台类目路径（尽量准确，如 Consumer Electronics > Cables > USB Cables）",
  "brand": "品牌（如无则留空字符串）",
  "keyAttributes": [ { "name": "属性名", "value": "属性值" } ],
  "variants": { "dimensions": ["颜色", "尺寸"], "skus": [ { "color": "", "size": "", "price": 0 } ] },
  "images": { "main": [] }
}
要求：
- 标题必须含核心关键词与可验证的差异化卖点（如接口类型、速率、功率、材质、长度）。
- 详情分「核心卖点 / 规格参数 / Q&A / 温馨提示」四段，参数须真实、不得编造不存在的指标。
- keyAttributes 覆盖：接口/标准、传输速率、视频输出、供电功率、线长、材质、兼容系统等真实参数。
- variants 按真实可售规格填写（颜色/尺寸），无变体则 dimensions/skus 留空数组。
- images.main 留空，由系统注入。`;

/**
 * 合成通用类目 profile。通用类目不绑定任何店铺级必填属性（requiredAttrs 为空），
 * 也不触发乳贴业务必填规范；仅依赖通用 product-fact schema 校验。
 */
const GENERIC_PROFILE = {
  key: GENERIC_PROFILE_KEY,
  label: "通用/其他类目",
  category: "",
  requiredAttrs: [],
  keyAttributes: [],
  factExtractPrompt: GENERIC_EXTRACT_PROMPT,
};

/**
 * 解析 profileKey：auto 时按 hints（类目名/关键词）做轻量推断；
 * 未命中已知三系（乳贴/箱包/包挂）时**回落到 generic，而非默认 ruTie**，
 * 避免把 USB4 线这类产品误判为乳贴。
 * @param {"ruTie"|"xiangBao"|"xiangBaoFold"|"bagCharm"|"generic"|"auto"} key
 * @param {object} [hints] 如 { category, mainKeyword, text }
 * @returns {string} 实际 profileKey
 */
export function resolveProfileKey(key, hints = {}) {
  if (key && key !== "auto") return key;
  const text = [hints.category, hints.mainKeyword, hints.text]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/箱包|内胆|insert|liner|bag/.test(text)) return "xiangBao";
  if (/包挂|吊坠|charm|pendant/.test(text)) return "bagCharm";
  if (/乳贴|胸贴|nipple|breast petal/.test(text)) return "ruTie";
  return GENERIC_PROFILE_KEY;
}

/**
 * 取类目 profile（已解析 auto）。未知/未注册 key 一律兜底为通用类目，
 * 保证引擎永不因类目缺失而崩溃或误用乳贴规范。
 * @param {string} key
 * @returns {object}
 */
export function getProfile(key) {
  if (key === GENERIC_PROFILE_KEY) return GENERIC_PROFILE;
  if (key && key !== "auto") {
    const p = getDianxiaomiProfile(key);
    if (p && p.key) return p;
  }
  return GENERIC_PROFILE;
}

/**
 * 取必填属性默认值列表（用于自纠错填默认值）。
 * @param {object} profile
 * @returns {Array<{label:string,id:string,value:string}>}
 */
export function getRequiredAttrDefaults(profile) {
  return (profile && profile.requiredAttrs) || [];
}
