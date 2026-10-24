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

  const { result, mode, thumb } = await visionQc({
    model,
    slot,
    imageFile,
    referenceImage,
    scoringConfig,
    thumbDir,
    skuLock,
  });

  const heroJudge = mode === "hero" ? judgeHeroScore(result.heroScore, scoringConfig) : null;
  const pass = deterministic.dimension.pass && result.verdict === "pass";

  return {
    slotId: slot.id,
    module: slot.module,
    dimension: deterministic.dimension,
    sku: result.sku,
    shotType: result.shotType,
    productFidelity: result.productFidelity,
    background: result.background,
    text: result.text,
    composition: result.composition,
    heroScore: result.heroScore,
    heroJudge: heroJudge ?? undefined,
    thumbnail: thumb ? { file: path.basename(thumb.file), size: thumb.size } : undefined,
    verdict: pass ? "pass" : "fail",
    reason: pass
      ? undefined
      : deterministic.dimension.pass
        ? result.reason || heroJudge?.reasons?.join("；")
        : deterministic.dimension.problems.join("；"),
  };
}
