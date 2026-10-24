// agents/ae-product-design/src/inputs.js
// S0/S1：输入校验与事实装载。全部确定性逻辑，不调用模型。

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AgentError, CODES } from "../../_shared/errors.js";
import { sanitizeFacts } from "../../_shared/permissions.js";
import { readImageInfo } from "./image-info.js";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_IMAGES = 8;
const MAX_SINGLE_BYTES = 12 * 1024 * 1024;
const MAX_MATERIAL_CHARS = 20000;

async function exists(p) {
  return stat(p).then(() => true).catch(() => false);
}

async function listImages(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(dir, e.name))
    .sort();
}

export async function loadSlots(slotsFile) {
  const file = slotsFile
    ? path.resolve(slotsFile)
    : path.join(import.meta.dirname, "..", "config", "image-slots.json");
  const raw = await readFile(file, "utf8").catch(() => null);
  if (!raw) throw new AgentError(CODES.INPUT_INVALID, `槽位配置读取失败：${file}`, { file });
  const config = JSON.parse(raw);
  if (!Array.isArray(config.slots) || config.slots.length === 0) {
    throw new AgentError(CODES.INPUT_INVALID, "槽位配置 slots 为空", { file });
  }
  const ids = new Set();
  for (const slot of config.slots) {
    if (!slot.id || ids.has(slot.id)) {
      throw new AgentError(CODES.INPUT_INVALID, `槽位 id 缺失或重复：${slot.id}`, { file });
    }
    ids.add(slot.id);
    if (!["forbidden", "optional", "allowed"].includes(slot.textPolicy)) {
      throw new AgentError(CODES.INPUT_INVALID, `槽位 ${slot.id} textPolicy 非法`, { file });
    }
    if (!config.spec?.[slot.specKey]) {
      throw new AgentError(CODES.INPUT_INVALID, `槽位 ${slot.id} 的 specKey「${slot.specKey}」在 spec 中不存在`, { file });
    }
    if (!config.spec[slot.specKey].aspect) {
      throw new AgentError(CODES.INPUT_INVALID, `spec.${slot.specKey} 缺少 aspect`, { file });
    }
  }
  if (!config.heroScoring?.dimensions?.length) {
    throw new AgentError(CODES.INPUT_INVALID, "缺少 heroScoring 配置（首图 100 分模型）", { file });
  }
  return { config, file, slots: config.slots, spec: config.spec };
}

export async function loadInputs({ productDir, factsFile, slotsFile }) {
  const warnings = [];
  const dir = path.resolve(productDir);
  if (!(await exists(dir))) {
    throw new AgentError(CODES.INPUT_INVALID, `产品目录不存在：${dir}`, { productDir: dir });
  }

  // 主路径：产品图/ 子目录；兜底：目录根部的图片
  let images = await listImages(path.join(dir, "产品图"));
  let imageSource = "产品图/";
  if (images.length === 0) {
    images = (await listImages(dir)).filter((f) => !f.includes(`${path.sep}design${path.sep}`));
    imageSource = "productDir 根目录";
    if (images.length > 0) warnings.push("NO_PRODUCT_IMAGE_DIR: 未找到 产品图/，改用根目录图片");
  }
  if (images.length === 0) {
    throw new AgentError(CODES.INPUT_IMAGES, `产品目录下没有任何可用图片：${dir}`, { productDir: dir });
  }
  if (images.length > MAX_IMAGES) {
    warnings.push(`IMAGES_TRUNCATED: 产品图 ${images.length} 张，仅取前 ${MAX_IMAGES} 张`);
    images = images.slice(0, MAX_IMAGES);
  }
  const imageInfos = [];
  for (const file of images) {
    const info = await readImageInfo(file);
    if (!info.readable) {
      warnings.push(`IMAGE_UNREADABLE: ${path.basename(file)} 无法解析，已跳过`);
      continue;
    }
    if (info.bytes > MAX_SINGLE_BYTES) {
      throw new AgentError(CODES.INPUT_IMAGES, `图片超过 12MB：${path.basename(file)}`, { file });
    }
    imageInfos.push(info);
  }
  if (imageInfos.length === 0) {
    throw new AgentError(CODES.INPUT_IMAGES, "所有产品图都无法解析", { productDir: dir });
  }

  // 产品事实：显式 > product-facts.json > product-profile.json
  const candidates = factsFile
    ? [path.resolve(factsFile)]
    : [path.join(dir, "product-facts.json"), path.join(dir, "product-profile.json")];
  let facts = {};
  let factsSource = "none";
  for (const candidate of candidates) {
    const raw = await readFile(candidate, "utf8").catch(() => null);
    if (!raw) continue;
    try {
      facts = JSON.parse(raw);
      factsSource = path.basename(candidate);
      break;
    } catch (error) {
      warnings.push(`FACTS_UNPARSABLE: ${path.basename(candidate)}`);
    }
  }
  if (factsSource === "none") warnings.push("NO_FACTS_FILE: 无 product-facts.json，仅凭图片与资料推断");

  // 资料原文
  const matFiles = (await readdir(dir).catch(() => []))
    .filter((name) => /\.(md|txt)$/i.test(name) && !/^(README|contract)/i.test(name))
    .sort()
    .slice(0, 5);
  let materialText = "";
  for (const name of matFiles) {
    const text = await readFile(path.join(dir, name), "utf8").catch(() => "");
    if (text) materialText += `\n--- ${name} ---\n${text}`;
  }
  if (materialText.length > MAX_MATERIAL_CHARS) {
    warnings.push(`MATERIAL_TRUNCATED: 资料 ${materialText.length} 字符，截断至 ${MAX_MATERIAL_CHARS}`);
    materialText = materialText.slice(0, MAX_MATERIAL_CHARS);
  }

  const { facts: safeFacts, redacted } = sanitizeFacts(facts);
  const slotBundle = await loadSlots(slotsFile);

  return {
    productDir: dir,
    imageSource,
    images: imageInfos.map((i) => i.file),
    imageInfos,
    facts: safeFacts,
    factsSource,
    materialText,
    redacted,
    warnings,
    ...slotBundle,
  };
}

/** 给模型读的产品事实摘要（有预算、可读、不含敏感字段） */
export function buildFactsText(input, { maxChars = 9000, vision = null, skuLockText = "" } = {}) {
  const lines = [];
  lines.push(`# 产品目录\n${input.productDir}`);
  lines.push(`# 产品图\n${input.images.map((f) => path.basename(f)).join(", ")}（视觉唯一真相，优先于文字描述）`);
  if (vision?.available) {
    lines.push(
      `# 本地视觉识别（${vision.model}，只作外观参考，不是市场结论）\n${skuLockText}` +
        (vision.attributes?.textOnImage?.length
          ? `\n参考图上出现的文字（不得复制到成图）：${vision.attributes.textOnImage.join(" / ")}`
          : ""),
    );
  }
  lines.push(`# 结构化事实（来源 ${input.factsSource}）\n${JSON.stringify(input.facts, null, 2).slice(0, 6000)}`);
  if (input.materialText) {
    lines.push(`# 产品资料原文\n${input.materialText.slice(0, 8000)}`);
  }
  if (input.redacted.length) {
    lines.push(`# 已脱敏字段（禁止推断或询问）\n${input.redacted.join(", ")}`);
  }
  return lines.join("\n\n").slice(0, maxChars + 2000);
}

/** 槽位定义给模型可读形式 */
export function buildSlotText(slots, specMap = {}) {
  return slots
    .map((s) => {
      const spec = specMap[s.specKey] ?? {};
      return [
        `## ${s.id} · ${s.name}（module=${s.module}, role=${s.role}, textPolicy=${s.textPolicy}${s.optional ? ", 可选可跳过" : ""}）`,
        `比例/尺寸：${spec.aspect ?? "1:1"} / ${spec.targetSize ?? "1000x1000"}（该槽位出图必须遵守）`,
        `考核：${s.primaryMetric ?? "-"}`,
        `用途：${s.purpose}`,
        `背景：${s.background}`,
        `主体占比：${s.productScale ?? "-"}`,
        `构图：${s.composition}`,
        `必须出现：${(s.mustShow ?? []).join("；")}`,
        `禁止出现：${(s.mustNotShow ?? []).join("；")}`,
        `风格提示：${s.styleHint ?? ""}`,
      ].join("\n");
    })
    .join("\n\n");
}
