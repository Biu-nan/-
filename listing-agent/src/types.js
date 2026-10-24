// Listing Agent 契约：输入 / 输出 / 端口接口。
// 纯类型与默认值，无运行时依赖（不 import 任何网站内核）。

/**
 * @typedef {Object} ListingInput
 * @property {"images"|"factsJson"|"factsMarkdown"|"sourceUrl"|"hybrid"} type 输入形态
 * @property {string[]} [images] 产品图绝对路径（type=images/hybrid）
 * @property {object} [factsJson] 部分或完整产品事实（type=factsJson/hybrid）
 * @property {string} [factsMarkdown] AI 提取的 markdown/JSON 文本（type=factsMarkdown）
 * @property {string} [sourceUrl] 来源 URL（type=sourceUrl）
 * @property {object} [overrides] 人工覆盖项，合并到最终 facts
 */

/**
 * @typedef {Object} ListingOptions
 * @property {"listing-only"|"full"} [mode] 生成范围，默认 listing-only
 * @property {boolean} [generateContent] 是否调用 AI 生成内容，默认 true（false=仅校验/归一化）
 * @property {boolean} [research] 是否联网市场调研（影响 MVP5），默认 true
 * @property {boolean} [publish] 是否上架店小秘（目地之一：意图），默认 false
 * @property {"reference"|"collect"|"auto"} [publishMode] 上架模式，默认 reference
 * @property {string} [targetStore] 目地之二：目的地/目标店小秘店铺或账号（如 "smtChoice:店铺A"）
 * @property {number} [maxAutoFixRounds] 自纠错最大轮数，默认 3
 * @property {string} [operationId] 幂等键
 */

/**
 * @typedef {Object} ListingRequest
 * @property {"ruTie"|"xiangBao"|"xiangBaoFold"|"bagCharm"|"auto"} profileKey 类目键（auto=自动识别）
 * @property {ListingInput} input 产品输入
 * @property {ListingOptions} [options] 运行选项
 */

/**
 * @typedef {Object} ValidationReport
 * @property {boolean} schemaValid ajv schema 是否通过
 * @property {object[]} schemaErrors ajv 错误数组
 * @property {{ok:boolean, missing:string[], requiredByProfile:string[]}} completeness 业务完整性
 * @property {number} qualityScore 质量评分 0-100
 * @property {string[]} warnings 警告
 */

/**
 * @typedef {Object} ListingResult
 * @property {"success"|"success_with_warnings"|"needs_human"|"failed"} status
 * @property {string} profileKey 实际使用的类目键
 * @property {object} facts 归一化、符合 schema 的 ProductFacts（可能不完整）
 * @property {ValidationReport} validation 校验报告
 * @property {string[]} autoFixLog 自纠错日志
 * @property {{status:string, mode?:string, target?:string, jobId?:string, errors?:string[]}} publish 上架结果
 * @property {{factFile?:string, contentFiles?:string[]}} artifacts 产物路径
 * @property {string[]} log 过程日志
 */

/**
 * AI 提供方端口：agent 核心只依赖此接口，不关心底层是网页版 ChatGPT 还是 API。
 * @typedef {Object} AIProvider
 * @property {Promise<{text:string}>} generateText(prompt:string, fingerprint:string, ctx?:{profileKey?:string, images?:string[]}) 生成文本
 * @property {Promise<{images:string[]}>} generateImage(prompt:string, fingerprint:string, ctx?:{profileKey?:string}) 生成图片（主图/营销图），返回图片文件绝对路径数组
 */

/**
 * 上架（发布）端口：agent 核心只依赖此接口。
 * @typedef {Object} ListingPublisher
 * @property {Promise<{status:string, mode?:string, target?:string, jobId?:string, errors?:string[]}>} publish(facts:object, opts:{mode?:string, operationId?:string, targetStore?:string}) 上架到店小秘
 */

/**
 * 用默认值补全请求并做基本校验。
 * @param {ListingRequest} req
 * @returns {ListingRequest}
 */
export function normalizeRequest(req) {
  if (!req || typeof req !== "object") {
    throw new Error("ListingRequest 必须是对象");
  }
  if (!req.input || typeof req.input !== "object") {
    throw new Error("ListingRequest.input 必填");
  }
  const profileKey = req.profileKey || "auto";
  const options = {
    mode: "listing-only",
    generateContent: true,
    research: true,
    publish: false,
    publishMode: "reference",
    targetStore: "",
    maxAutoFixRounds: 3,
    operationId: "",
    ...(req.options || {}),
  };
  const input = {
    type: "images",
    images: [],
    factsJson: undefined,
    factsMarkdown: "",
    sourceUrl: "",
    overrides: {},
    ...req.input,
  };
  if (!Number.isInteger(options.maxAutoFixRounds) || options.maxAutoFixRounds < 0 || options.maxAutoFixRounds > 3) {
    throw new Error("maxAutoFixRounds 必须是 0–3 的整数");
  }
  return { profileKey, input, options };
}

/**
 * 判定 status 是否成功（含带警告的成功）。
 * @param {string} status
 * @returns {boolean}
 */
export function isOk(status) {
  return status === "success" || status === "success_with_warnings";
}
