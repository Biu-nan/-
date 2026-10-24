// agents/_shared/schemas.js
// 关键结果一律结构化 + 强校验：字段缺失直接抛 E_SCHEMA_INVALID，不允许"先跑下去"。

import { AgentError, CODES } from "./errors.js";

const fail = (where, msg) => {
  throw new AgentError(CODES.SCHEMA_INVALID, `${where}: ${msg}`);
};
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

export const BANNED_WORDS = [
  "best seller",
  "no.1",
  "no 1",
  "100%",
  "medical",
  "therapeutic",
  "cure",
  "fda",
  "最好",
  "第一",
  "治疗",
];

export function assertNoBannedWords(text, where) {
  const low = String(text).toLowerCase();
  for (const word of BANNED_WORDS) {
    if (low.includes(word)) fail(where, `命中禁用词「${word}」`);
  }
}

export function validateStyleDossier(dossier, { refCount } = {}) {
  const where = "style-dossier";
  if (!isObj(dossier)) fail(where, "根节点必须是对象");
  if (!isStr(dossier.categoryKey)) fail(`${where}.categoryKey`, "缺失");
  if (!Array.isArray(dossier.series) || dossier.series.length < 2 || dossier.series.length > 3) {
    fail(`${where}.series`, "必须是 2–3 套系列");
  }
  const ids = new Set();
  for (const [i, series] of dossier.series.entries()) {
    const at = `${where}.series[${i}]`;
    if (!isObj(series)) fail(at, "必须是对象");
    for (const key of ["id", "name", "thesis", "composition", "lighting", "background", "productScale", "narrative"]) {
      if (!isStr(series[key])) fail(`${at}.${key}`, "缺失或空");
    }
    if (ids.has(series.id)) fail(`${at}.id`, "重复");
    ids.add(series.id);
    if (!Array.isArray(series.palette) || series.palette.length < 2 || series.palette.length > 4) {
      fail(`${at}.palette`, "需要 2–4 个颜色");
    }
    if (!["none", "labels", "benefit-bars", "headline"].includes(series.textDensity)) {
      fail(`${at}.textDensity`, "取值非法");
    }
    if (!["params", "lifestyle", "texture", "gifting"].includes(series.narrative)) {
      fail(`${at}.narrative`, "取值非法");
    }
    if (!Array.isArray(series.evidence) || series.evidence.length === 0) {
      fail(`${at}.evidence`, "至少 1 条证据");
    }
    if (refCount) {
      for (const ref of series.evidence) {
        if (!Number.isInteger(ref) || ref < 1 || ref > refCount) {
          fail(`${at}.evidence`, `引用编号 ${ref} 不存在（共 ${refCount} 张参考图）`);
        }
      }
    }
  }
  const recommended = dossier.series.filter((s) => s.recommended === true);
  if (recommended.length !== 1) fail(`${where}.series`, "必须且只能有 1 套 recommended=true");
  if (!isStr(dossier.chosen) || dossier.chosen !== recommended[0].id) {
    fail(`${where}.chosen`, "必须等于 recommended 系列的 id");
  }
  return dossier;
}

export function validateStoryboard(sb, slots) {
  const where = "storyboard";
  if (!isObj(sb)) fail(where, "根节点必须是对象");
  if (!Array.isArray(sb.items)) fail(`${where}.items`, "必须是数组");
  if (sb.items.length !== slots.length) {
    fail(`${where}.items`, `应有 ${slots.length} 条，实际 ${sb.items.length} 条`);
  }
  slots.forEach((slot, i) => {
    const item = sb.items[i];
    const at = `${where}.items[${i}]`;
    if (!isObj(item)) fail(at, "必须是对象");
    if (item.slotId !== slot.id) fail(`${at}.slotId`, `应为 ${slot.id}，实际 ${item.slotId}`);
    if (item.role !== slot.role) fail(`${at}.role`, `应为 ${slot.role}`);
    // 可选槽位允许显式跳过（不为凑数量重复图片）
    if (item.skip === true) {
      if (!slot.optional) fail(`${at}.skip`, `槽位 ${slot.id} 不支持跳过`);
      if (!isStr(item.skipReason)) fail(`${at}.skipReason`, "跳过必须给出理由");
      return;
    }
    if (typeof item.headline !== "string") fail(`${at}.headline`, "必须是字符串（无文案时为空串）");
    if (item.headline.length > 42) fail(`${at}.headline`, "超过 42 字符");
    if (slot.textPolicy === "forbidden" && item.headline !== "") {
      fail(`${at}.headline`, "该槽位禁止文字，headline 必须为空串");
    }
    if (!isStr(item.sellingPoint)) fail(`${at}.sellingPoint`, "缺失");
    assertNoBannedWords(item.sellingPoint, `${at}.sellingPoint`);
    if (!isStr(item.composition)) fail(`${at}.composition`, "缺失");
    if (!isStr(item.background)) fail(`${at}.background`, "缺失");
    if (!isStrArray(item.props ?? [])) fail(`${at}.props`, "必须是字符串数组");
    if (!Array.isArray(item.fidelityAnchors) || item.fidelityAnchors.length < 3) {
      fail(`${at}.fidelityAnchors`, "至少 3 条外观锚点");
    }
  });
  return sb;
}

/**
 * 首图 100 分模型：只校验结构合法性（维度齐全、分项不超权重、总分等于分项和）。
 * 是否达阈值由 qc 判定，避免把"画得不够好"误报成 schema 错误。
 */
export function validateHeroScoreStructure(payload, scoringConfig) {
  const where = "hero-score";
  if (!isObj(payload)) fail(where, "必须是对象");
  if (!Array.isArray(payload.dimensions)) fail(`${where}.dimensions`, "必须是数组");
  const expected = new Map(scoringConfig.dimensions.map((d) => [d.key, d]));
  if (payload.dimensions.length !== expected.size) {
    fail(`${where}.dimensions`, `应有 ${expected.size} 个维度，实际 ${payload.dimensions.length} 个`);
  }
  let sum = 0;
  const seen = new Set();
  for (const dim of payload.dimensions) {
    const at = `${where}.dimensions.${dim?.key}`;
    const cfg = expected.get(dim?.key);
    if (!cfg) fail(at, "未知维度 key");
    if (seen.has(dim.key)) fail(at, "维度重复");
    seen.add(dim.key);
    if (typeof dim.score !== "number" || Number.isNaN(dim.score)) fail(at, "score 必须是数字");
    if (dim.score < 0 || dim.score > cfg.weight) fail(at, `score ${dim.score} 超出 0–${cfg.weight}`);
    sum += dim.score;
  }
  if (typeof payload.total !== "number") fail(`${where}.total`, "必须是数字");
  if (Math.abs(payload.total - sum) > 0.51) {
    fail(`${where}.total`, `total ${payload.total} 与分项之和 ${sum} 不一致`);
  }
  return payload;
}

/** 首图是否达标：总分阈值 + 每个维度的最低占比 */
export function judgeHeroScore(payload, scoringConfig) {
  const expected = new Map(scoringConfig.dimensions.map((d) => [d.key, d]));
  const reasons = [];
  for (const dim of payload.dimensions) {
    const cfg = expected.get(dim.key);
    const floor = cfg.weight * (cfg.minRatio ?? 0.6);
    if (dim.score < floor) reasons.push(`${cfg.label} ${dim.score}/${cfg.weight} 低于下限 ${floor.toFixed(1)}`);
  }
  const total = payload.total;
  if (total < scoringConfig.threshold) reasons.push(`总分 ${total} 低于阈值 ${scoringConfig.threshold}`);
  return { pass: reasons.length === 0, total, threshold: scoringConfig.threshold, reasons };
}

export function validatePromptPack(pack, slots, specMap = {}) {
  const where = "prompt-pack";
  if (!isObj(pack)) fail(where, "根节点必须是对象");
  if (!Array.isArray(pack.prompts)) fail(`${where}.prompts`, "必须是数组");
  if (pack.prompts.length !== slots.length) {
    fail(`${where}.prompts`, `应有 ${slots.length} 条，实际 ${pack.prompts.length} 条`);
  }
  slots.forEach((slot, i) => {
    const item = pack.prompts[i];
    const at = `${where}.prompts[${i}]`;
    if (!isObj(item)) fail(at, "必须是对象");
    if (item.slotId !== slot.id) fail(`${at}.slotId`, `应为 ${slot.id}`);
    if (item.skip === true) return;
    const prompt = item.prompt;
    if (!isStr(prompt)) fail(`${at}.prompt`, "缺失");
    if (prompt.length < 120) fail(`${at}.prompt`, "过短（<120 字符），约束不完整");
    const spec = specMap[slot.specKey] ?? {};
    const aspect = spec.aspect ?? "1:1";
    const targetSize = spec.targetSize ?? "1000x1000";
    if (!prompt.toLowerCase().includes(aspect)) fail(`${at}.prompt`, `缺少比例声明「${aspect}」`);
    if (!prompt.toLowerCase().includes(targetSize.toLowerCase())) {
      fail(`${at}.prompt`, `缺少目标尺寸声明「${targetSize}」`);
    }
    if (!prompt.toLowerCase().includes("no watermark")) fail(`${at}.prompt`, "缺少 no watermark 声明");
    if (!/reference image/i.test(prompt)) fail(`${at}.prompt`, "缺少产品保真约束（须引用 reference image）");
    // 允许出现 "no collage / no multi-panel" 这类否定式，只有"要求拼图"才违规
    const withoutNegations = prompt.replace(/\b(no|not|without|avoid|never)\b[^.]{0,40}/gi, "");
    if (/collage|multi-?panel|grid of images|contact sheet/i.test(withoutNegations)) {
      fail(`${at}.prompt`, "禁止拼图/宫格要求");
    }
    assertNoBannedWords(prompt, `${at}.prompt`);
  });
  return pack;
}

export function validateQc(qc, slot) {
  const where = `qc[${slot.id}]`;
  if (!isObj(qc)) fail(where, "必须是对象");
  if (qc.slotId !== slot.id) fail(`${where}.slotId`, `应为 ${slot.id}`);
  for (const key of ["productFidelity", "background", "text", "composition"]) {
    if (!isObj(qc[key])) fail(`${where}.${key}`, "缺失");
  }
  if (typeof qc.productFidelity.pass !== "boolean") fail(`${where}.productFidelity.pass`, "必须是布尔");
  if (typeof qc.background.pass !== "boolean") fail(`${where}.background.pass`, "必须是布尔");
  if (typeof qc.text.policyOk !== "boolean") fail(`${where}.text.policyOk`, "必须是布尔");
  if (typeof qc.composition.pass !== "boolean") fail(`${where}.composition.pass`, "必须是布尔");

  // SKU 归属：参考图含多款时，画成别的款必须判失败（防货不对板）
  let skuFail = false;
  if (qc.sku !== undefined) {
    if (!isObj(qc.sku)) fail(`${where}.sku`, "必须是对象");
    if (typeof qc.sku.pass !== "boolean") fail(`${where}.sku.pass`, "必须是布尔");
    if (!isStr(qc.sku.detected)) fail(`${where}.sku.detected`, "必须写明实际看到的款式");
    skuFail = qc.sku.pass === false;
  }

  // 镜头类型：macro/full/lifestyle/diagram/flatlay 必须匹配槽位定义
  let shotFail = false;
  if (slot.shot) {
    if (!isObj(qc.shotType)) fail(`${where}.shotType`, `缺镜头类型判定（槽位要求 ${slot.shot}）`);
    if (typeof qc.shotType.match !== "boolean") fail(`${where}.shotType.match`, "必须是布尔");
    shotFail = qc.shotType.match === false;
  }

  if (!["pass", "fail"].includes(qc.verdict)) fail(`${where}.verdict`, "取值非法");
  const derivedFail =
    skuFail ||
    shotFail ||
    !qc.productFidelity.pass ||
    !qc.background.pass ||
    !qc.text.policyOk ||
    !qc.composition.pass;
  if (derivedFail && qc.verdict !== "fail") fail(`${where}.verdict`, "存在失败项却判 pass");
  return qc;
}
