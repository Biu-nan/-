// Stage 2 · GENERATE（内容生成）：调用 AI 补全 facts；full 模式额外生图并注入 images.main。
// 复用 dist/src/dianxiaomi-facts.js 的 normalizeDianxiaomiFacts 与 knowledge 里的桥接 prompt。
import path from "node:path";
import { normalizeDianxiaomiFacts } from "../../../dist/src/dianxiaomi-facts.js";
import { PRODUCT_FACTS_STRUCTURE_PROMPT } from "../knowledge/profiles.js";
import { extractJson } from "../util.js";

function basenameList(files) {
  return (files || []).map((f) => path.basename(f));
}

/**
 * 构建生图提示词：严格以参考图为准，禁止货不对版。
 * 参考图通过 ctx.images 传进 ChatGPT（见 chatgpt-provider.generateImage），
 * 这里只负责把「颜色/材质/版型锁定 + 否定项」写进文字指令。
 * @param {object} profile 类目 profile
 * @param {object} facts 已提取的产品事实（用于产品类型上下文）
 * @param {string[]} [referenceImages] 参考图本地路径列表
 */
function buildImagePrompt(profile, facts, referenceImages) {
  const ptype =
    (facts && facts.title && (facts.title.en || facts.title.zh)) ||
    (profile && profile.key) ||
    "产品";
  const refNote =
    referenceImages && referenceImages.length
      ? `我已上传 ${referenceImages.length} 张参考图，请严格以它们为唯一标准。`
      : "（未提供参考图，请仅按下方产品事实生成，颜色/版型由你合理默认）";
  return [
    "你正在为跨境电商 Listing 生成产品主图。规则高于一切：",
    "",
    "【唯一标准】",
    refNote,
    "参考图里产品的颜色、材质、版型、配件、数量必须与生成图 100% 一致。",
    "参考图没有的属性，禁止自行添加（尤其不得加品牌 logo、图案、文字）。",
    "",
    "【颜色硬约束】",
    "先读取参考图主体颜色，生成图主体颜色必须与其严格一致、鲜艳饱和，",
    "不得向米色/棕色/驼色/浅色漂移。",
    "",
    "【版型/材质硬约束】",
    "形状、分隔袋数量、拉链/卡位位置、整体厚度、材质质感必须与参考图一致。",
    "",
    "【风格】",
    "纯白背景，产品居中，电商主图风格，高清晰度。",
    "",
    "【禁止项（务必遵守）】",
    "NOT beige, NOT brown, NOT tan, NOT pastel。",
    "do NOT change the color, do NOT alter the shape, do NOT add logos or text。",
    "",
    `请基于参考图为「${ptype}」生成一组电商主图（白底为主，可含少量场景），共 6 张，`,
    "每一张都必须与参考图颜色/版型严格一致。",
  ].join("\n");
}

/**
 * 生成/补全产品事实。不修改 request，返回新 facts。
 * @param {object} args
 * @param {object} args.request 归一化后的 ListingRequest
 * @param {object} args.facts parse 阶段产出的草稿
 * @param {object} args.profile 类目 profile
 * @param {object} args.ai AIProvider 实例
 * @param {object} [args.workspace] { scannedImages?: string[] } 工作区已扫描到的图片文件名
 * @returns {Promise<{facts:object, generated:boolean, note:string}>}
 */
export async function generateStage({ request, facts, profile, ai, workspace }) {
  const { input, options } = request;

  // 仅校验/归一化模式：跳过 AI
  if (options.generateContent === false) {
    return { facts, generated: false, note: "generateContent=false，跳过 AI 生成" };
  }

  const alreadyComplete = !!(facts.title && (facts.title.zh || facts.title.en)) &&
    !!(facts.description && (facts.description.pc || facts.description.mobile));

  // 已有结构化 facts 且完整：无需再调 AI
  if ((input.type === "factsJson" || input.type === "factsMarkdown") && alreadyComplete) {
    return { facts, generated: false, note: "已含完整事实，跳过 AI" };
  }

  // 构造 prompt：类目事实提取 + 桥接整理
  const factPrompt = (profile && profile.factExtractPrompt) || "# 产品事实提取";
  const prompt = [
    factPrompt,
    "",
    "---",
    PRODUCT_FACTS_STRUCTURE_PROMPT,
    "",
    "请综合产品图与可见事实，直接输出符合上述形状的 JSON 代码块（含 title/description/keyAttributes/variants；images.main 留空，后端注入）。",
  ].join("\n");

  const images = input.images && input.images.length ? input.images : undefined;
  const res = await ai.generateText(prompt, "FACTS_BRIDGE", { profileKey: profile && profile.key, images });
  let parsed;
  try {
    parsed = extractJson(res.text);
  } catch (e) {
    throw new Error("AI 返回无法解析为 facts JSON: " + (e && e.message ? e.message : e));
  }
  const sourceProvenance = facts.meta?.provenance;
  facts = normalizeDianxiaomiFacts(parsed);
  // 生成内容不能清除导入资料原有的复核要求和证据缺口。
  if (sourceProvenance) facts.meta.provenance = structuredClone(sourceProvenance);

  // 注入主图：优先 input.images 文件名；否则用工作区扫描结果
  if (images && images.length) {
    facts.images.main = basenameList(images).slice(0, 6);
  } else if (workspace && Array.isArray(workspace.scannedImages) && workspace.scannedImages.length) {
    facts.images.main = workspace.scannedImages.slice(0, 6);
  }

  // full 模式：生图并覆盖主图（严格以参考图为准，禁止货不对版）
  if (options.mode === "full") {
    const imgPrompt = buildImagePrompt(profile, facts, images);
    const imgRes = await ai.generateImage(
      imgPrompt,
      "LISTING_IMAGES",
      { profileKey: profile && profile.key, images }
    );
    if (imgRes && Array.isArray(imgRes.images) && imgRes.images.length) {
      facts.images.main = basenameList(imgRes.images).slice(0, 6);
    }
  }

  return { facts, generated: true, note: "AI 生成/补全 facts 完成" };
}
