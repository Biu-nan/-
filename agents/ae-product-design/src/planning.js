// agents/ae-product-design/src/planning.js
// S3–S5：风格聚类 → storyboard → prompt pack。三个模型调用点，全部结构化输出 + 强校验。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { validatePromptPack, validateStoryboard, validateStyleDossier } from "../../_shared/schemas.js";
import { readJson } from "../../_shared/state.js";

const PROMPT_DIR = path.join(import.meta.dirname, "..", "prompts");
const CONFIG_DIR = path.join(import.meta.dirname, "..", "config");

const cache = new Map();

export async function loadPrompt(name) {
  if (!cache.has(name)) {
    cache.set(name, await readFile(path.join(PROMPT_DIR, name), "utf8"));
  }
  return cache.get(name);
}

export function fill(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (values[key] === undefined) throw new Error(`Prompt 占位符未填充：${key}`);
    return String(values[key]);
  });
}

/** S3：风格聚类。refImages 已上传到当前会话，这里只描述数量与来源构成。 */
export async function clusterStyles({ model, tracer, factsText, refs, categoryKey }) {
  const template = await loadPrompt("01_style_cluster.md");
  const composition = refs.reduce((acc, ref) => {
    acc[ref.source] = (acc[ref.source] ?? 0) + 1;
    return acc;
  }, {});
  const prompt = [
    template,
    "---",
    `# 本次附件：${refs.length} 张竞品参考图，按上传顺序编号 1..${refs.length}`,
    `来源构成：${JSON.stringify(composition)}`,
    `建议 categoryKey：${categoryKey}`,
    "选定系列必须同时适配：商品六图（统一 1:1，首图 70%–85% 主体、缩略图可辨）与独立营销图（1:1 白底 + 3:4 竖版场景，均无文字）。",
    "---",
    factsText,
  ].join("\n\n");

  const dossier = await model.askJson({
    label: "style-cluster",
    prompt,
    profile: "research",
    validate: (json) => validateStyleDossier(json, { refCount: refs.length }),
  });
  await tracer.write("context.selected", { output_summary: { series: dossier.series.map((s) => s.id) } });
  return dossier;
}

/** 调研全败时的降级：内置风格库，报告里 styleSource=fallback */
export async function fallbackDossier({ refs = [], categoryKey = "unknown" } = {}) {
  const library = await readJson(path.join(CONFIG_DIR, "style-library.json"));
  if (!library?.series?.length) throw new Error("内置风格库缺失");
  const series = library.series.map((item) => ({
    ...item,
    evidence: refs.length ? [1] : [],
  }));
  return {
    schemaVersion: "1.0",
    categoryKey,
    marketSignal: { dominantPattern: "内置库（未联网调研）", saturationRisk: "unknown" },
    series,
    chosen: series.find((s) => s.recommended)?.id ?? series[0].id,
    reason: "双源调研失败，使用预置风格库，建议人工复核风格新鲜度",
    source: "fallback",
  };
}

/** S4：storyboard */
export async function buildStoryboard({ model, slots, factsText, slotText, dossier, skuLock = "" }) {
  const template = await loadPrompt("02_storyboard.md");
  const chosen = dossier.series.find((s) => s.id === dossier.chosen) ?? dossier.series[0];
  const prompt = fill(template, {
    PRODUCT_FACTS: factsText,
    STYLE_SERIES: JSON.stringify(chosen, null, 2),
    SLOT_SPEC: slotText,
    SKU_LOCK: skuLock || "（本次没有本地识别结果；只描述 facts 标题所指的那一款）",
  });
  return model.askJson({
    label: "storyboard",
    prompt,
    profile: "planning",
    validate: (json) => validateStoryboard(json, slots),
  });
}

/** S5：prompt pack */
export async function buildPromptPack({ model, slots, specMap, factsText, slotText, dossier, storyboard, skuLock = "" }) {
  const template = await loadPrompt("03_image_prompt_pack.md");
  const chosen = dossier.series.find((s) => s.id === dossier.chosen) ?? dossier.series[0];
  const body = fill(template, {
    PRODUCT_FACTS: factsText,
    STYLE_SERIES: JSON.stringify(chosen, null, 2),
    STORYBOARD: JSON.stringify(storyboard, null, 2),
    SKU_LOCK: skuLock || "（本次没有本地识别结果；只描述 facts 标题所指的那一款）",
  });
  const prompt = `${body}\n\n---\n# 槽位约束（Prompt 必须守住）\n${slotText}`;
  return model.askJson({
    label: "prompt-pack",
    prompt,
    profile: "planning",
    validate: (json) => validatePromptPack(json, slots, specMap),
  });
}

/** S7 视觉 QC 的 prompt 组装：hero 模式多一张 160×160 缩略图 */
export async function buildQcPrompt(slot, { mode = "standard", skuLock = "" } = {}) {
  const template = await loadPrompt("04_vision_qc.md");
  return fill(template, {
    MODE: mode,
    SHOT: slot.shot ?? "any",
    SKU_LOCK: skuLock || "（本次没有本地识别结果，按参考图判断是否同一款式）",
    SLOT: JSON.stringify(
      {
        id: slot.id,
        module: slot.module,
        name: slot.name,
        role: slot.role,
        background: slot.background,
        textPolicy: slot.textPolicy,
        textAllowed: slot.textAllowed ?? [],
        composition: slot.composition,
        productScale: slot.productScale,
        mustShow: slot.mustShow ?? [],
        mustNotShow: slot.mustNotShow ?? [],
      },
      null,
      2,
    ),
  });
}

// ===== dry-run 用的确定性合成器：不调用模型，只验证 schema 与文件链路 =====

export function synthesizeStoryboard({ slots, dossier }) {
  const chosen = dossier.series.find((s) => s.id === dossier.chosen) ?? dossier.series[0];
  return {
    schemaVersion: "2.0",
    seriesId: chosen.id,
    synthetic: true,
    items: slots.map((slot) => ({
      slotId: slot.id,
      role: slot.role,
      skip: false,
      headline: slot.textPolicy === "forbidden" ? "" : slot.name,
      sellingPoint: `${slot.name}（dry-run 合成，未取产品事实）`,
      composition: slot.composition,
      background: slot.background,
      props: [],
      textPolicy: slot.textPolicy,
      fidelityAnchors: [
        "整体外形与比例与参考图一致",
        "主色与材质观感与参考图一致",
        "可见结构件（拉链/提手/缝线等）位置不变",
      ],
    })),
  };
}

export function synthesizePromptPack({ slots, specMap = {} }) {
  return {
    schemaVersion: "2.0",
    synthetic: true,
    prompts: slots.map((slot) => {
      const spec = specMap[slot.specKey] ?? { aspect: "1:1", targetSize: "1000x1000" };
      const frame =
        spec.aspect === "3:4"
          ? "Vertical 3:4 composition, 1000x1334 px"
          : "Square 1:1 composition, 1000x1000 px";
      return {
        slotId: slot.id,
        skip: false,
        prompt:
          `Product photography of the exact item shown in the uploaded reference image. ${slot.composition} ` +
          `Background: ${slot.background}, clean and uncluttered. Keep the product exactly as in the reference image: ` +
          `do not redesign, recolor, resize or reletter any part of it. ${
            slot.textPolicy === "forbidden" ? "Absolutely no text of any kind. " : "Only the allowed minimal text. "
          }` +
          `${frame}, product fully inside frame with 8% margin, sRGB, no watermark, no border, ` +
          "no collage grid, single image only.",
      };
    }),
  };
}
