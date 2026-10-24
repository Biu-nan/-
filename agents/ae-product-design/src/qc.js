// agents/ae-product-design/src/qc.js
// S7：确定性比例/尺寸/体积校验 + 视觉判定；首图额外跑 100 分模型与 160×160 缩略图检验。

import path from "node:path";
import { dimensionVerdict, readImageInfo } from "./image-info.js";
import { judgeHeroScore, validateHeroScoreStructure, validateQc } from "../../_shared/schemas.js";
import { buildQcPrompt } from "./planning.js";
import { makeThumbnail } from "./image-tools.js";

export async function deterministicQc(imageFile, spec) {
  const info = await readImageInfo(imageFile);
  const verdict = dimensionVerdict(info, spec);
  return {
    info,
    dimension: {
      pass: verdict.pass,
      problems: verdict.problems,
      width: info.width,
      height: info.height,
      ratio: verdict.ratio,
      target: verdict.target,
      bytes: info.bytes,
    },
  };
}

// 此判定也用于恢复旧状态：历史上写入的 pass 不能绕过现行必查项。
export function isQcDeliverable(qc, slot = {}) {
  return qc?.verdict === "pass" && qc.dimension?.pass === true &&
    qc.productFidelity?.pass === true && qc.background?.pass === true &&
    qc.text?.policyOk === true && qc.composition?.pass === true &&
    (!qc.sku || qc.sku.pass === true) && (!slot.shot || qc.shotType?.match === true) &&
    (!slot.scoring || (qc.heroJudge?.pass === true && qc.thumbnail?.size === 160 && Boolean(qc.thumbnail.file))) &&
    qc.source !== "local-vl";
}

export function composeQcResult({ slot, dimension, result, scoringConfig, thumbnail }) {
  validateQc(result, slot);
  let heroJudge;
  if (slot.scoring) {
    validateHeroScoreStructure(result.heroScore, scoringConfig);
    heroJudge = judgeHeroScore(result.heroScore, scoringConfig);
  }
  const reasons = [
    ...(dimension.pass ? [] : dimension.problems ?? ["尺寸检查未通过"]),
    ...(result.verdict === "pass" ? [] : [result.reason || "视觉检查未通过"]),
    ...(heroJudge?.pass === false ? heroJudge.reasons : []),
  ];
  const verdict = reasons.length ? "fail" : slot.scoring && !thumbnail ? "unverified" : "pass";
  return {
    slotId: slot.id, module: slot.module, dimension,
    sku: result.sku, shotType: result.shotType, productFidelity: result.productFidelity,
    background: result.background, text: result.text, composition: result.composition,
    heroScore: result.heroScore, heroJudge,
    thumbnail: thumbnail ? { file: path.basename(thumbnail.file), size: thumbnail.size } : undefined,
    verdict, reason: verdict === "pass" ? undefined : reasons.join("；") || "首图缩略图尚未验证",
  };
}

export function buildLocalQc({ slot, dimension, audit }) {
  const checked = audit?.available === true;
  const knownFailure = dimension.pass === false || (checked &&
    (audit.isTargetSku === false || audit.shotMatch === false || audit.hasText === true));
  return {
    slotId: slot.id, module: slot.module, dimension,
    sku: { pass: checked ? audit.isTargetSku ?? null : null, detected: audit?.sku ?? null },
    shotType: { present: audit?.shotType ?? null, match: checked ? audit.shotMatch ?? null : null },
    text: { present: checked ? audit.hasText ?? null : null, policyOk: checked && typeof audit.hasText === "boolean" ? audit.hasText === false : null },
    productFidelity: { pass: null, status: "unverified" },
    background: { pass: null, status: "unverified" },
    composition: { pass: null, status: "unverified" },
    source: "local-vl", coverage: ["dimension", ...(checked ? ["sku", "shotType", "text"] : [])],
    verdict: knownFailure ? "fail" : "unverified",
    reason: knownFailure ? `局部检查未通过：${[...(dimension.problems ?? []), audit?.notes || audit?.reason || "SKU/镜头/文字检查"].join("；")}`
      : "本地仅检查尺寸、SKU、镜头和文字，其余必查项尚未验证，不能交付",
  };
}

/**
 * 视觉 QC：新开对话上传「成图 + 产品参考图(+缩略图)」，四项二元判定；首图追加 100 分模型。
 * 无法判断必须判 fail（prompt 已约束），不允许默认放行。
 */
export async function visionQc({ model, slot, imageFile, referenceImage, scoringConfig, thumbDir, skuLock = "" }) {
  const mode = slot.scoring ? "hero" : "standard";
  const attachments = [imageFile, referenceImage];
  let thumb = null;
  if (mode === "hero") {
    thumb = await makeThumbnail(imageFile, path.join(thumbDir, `${slot.id}_160.jpg`), 160);
    if (thumb) attachments.push(thumb.file);
  }
  const prompt = await buildQcPrompt(slot, { mode, skuLock });
  await model.openPlanningChat(attachments);
  const legend = thumb
    ? "第 1 张=成图，第 2 张=产品参考图，第 3 张=160×160 缩略图。"
    : "第 1 张=成图，第 2 张=产品参考图。";
  const result = await model.askJson({
    label: `qc-${slot.id}`,
    prompt: `${prompt}\n\n---\n${legend} MODE=${mode}。`,
    profile: "identify",
    validate: (json) => {
      validateQc(json, slot);
      if (mode === "hero") {
        if (!json.heroScore) throw new Error("hero 模式缺少 heroScore");
        validateHeroScoreStructure(json.heroScore, scoringConfig);
      }
    },
  });
  return { result, mode, thumb };
}

export async function runQc({ model, slot, spec, scoringConfig, imageFile, referenceImage, vision = true, thumbDir, skuLock = "" }) {
  const deterministic = await deterministicQc(imageFile, spec);
  if (!vision) {
    return {
      slotId: slot.id,
      module: slot.module,
      dimension: deterministic.dimension,
      vision: { skipped: true, reason: "visionQc=false" },
      verdict: deterministic.dimension.pass ? "unverified" : "fail",
      reason: deterministic.dimension.pass ? "仅做比例/尺寸校验，视觉项未验证" : deterministic.dimension.problems.join("；"),
    };
  }

  const { result, thumb } = await visionQc({
    model,
    slot,
    imageFile,
    referenceImage,
    scoringConfig,
    thumbDir,
    skuLock,
  });

  return composeQcResult({ slot, dimension: deterministic.dimension, result, scoringConfig, thumbnail: thumb });
}
