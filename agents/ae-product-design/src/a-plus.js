// agents/ae-product-design/src/a-plus.js
// Amazon A+ 套图：模块编排 → 逐图出图 → 精确尺寸 → 模块级验收。
// 套图逻辑固定在 config/a-plus-modules.json（模块/像素/顺序/红线），
// 这里只负责把它跑起来，不在代码里另写一套规范。

import { execFile } from "node:child_process";
import { readFile, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AgentError, CODES } from "../../_shared/errors.js";
import { fill, loadPrompt } from "./planning.js";

const execFileP = promisify(execFile);
const EXACT_SCRIPT = path.join(import.meta.dirname, "exact_size.py");

const PYTHON_CANDIDATES = [
  process.env.WORKBUDDY_PYTHON,
  path.join(os.homedir(), ".workbuddy", "binaries", "python", "envs", "default", "Scripts", "python.exe"),
  "python3",
  "python",
].filter(Boolean);

let pythonCache;
async function resolvePython() {
  if (pythonCache !== undefined) return pythonCache;
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      await execFileP(candidate, ["-c", "import PIL"], { timeout: 10_000 });
      pythonCache = candidate;
      return candidate;
    } catch {
      /* next */
    }
  }
  pythonCache = null;
  return null;
}
export function loadCatalog() {
  return JSON.parse(
    readFileSync(path.join(import.meta.dirname, "..", "config", "a-plus-modules.json"), "utf8"),
  );
}

/** 把目录压成给模型看的紧凑描述 */
export function catalogForPrompt(catalog) {
  const lines = [];
  for (const id of catalog.moduleOrder) {
    const m = catalog.modules[id];
    if (!m) continue;
    const imgs = m.images.map((i) => `${i.slot} ${i.size[0]}x${i.size[1]}px（${i.role}）`).join("；");
    lines.push(`- ${id}｜${m.label}｜图片：${imgs}｜文案位：${m.textPlacements}｜文案提示：${m.copyHint}`);
  }
  return lines.join("\n");
}

/** 校验模型给的套图方案：模块合法、数量、顺序、尺寸、问句标题 */
export function validateAplusPlan(plan, catalog) {
  const where = "aPlusPlan";
  if (!plan || !Array.isArray(plan.modules)) {
    throw new AgentError(CODES.E_SCHEMA_INVALID, `${where}.modules 缺失`);
  }
  if (plan.modules.length < 4 || plan.modules.length > 6) {
    throw new AgentError(CODES.E_SCHEMA_INVALID, `${where}.modules 必须 4–6 个，实际 ${plan.modules.length}`);
  }
  const order = catalog.moduleOrder;
  let lastIndex = -1;
  for (const mod of plan.modules) {
    const spec = catalog.modules[mod.moduleId];
    if (!spec) throw new AgentError(CODES.E_SCHEMA_INVALID, `${where}: 未知模块 ${mod.moduleId}`);
    const idx = order.indexOf(mod.moduleId);
    if (idx < 0) throw new AgentError(CODES.E_SCHEMA_INVALID, `${where}: 模块 ${mod.moduleId} 不在顺序规则内`);
    if (idx < lastIndex) {
      throw new AgentError(CODES.E_SCHEMA_INVALID, `${where}: 模块顺序违反规则（${mod.moduleId}）`);
    }
    lastIndex = idx;
    if (!Array.isArray(mod.images) || mod.images.length !== spec.images.length) {
      throw new AgentError(
        CODES.E_SCHEMA_INVALID,
        `${where}: ${mod.moduleId} 图片数应为 ${spec.images.length}，实际 ${mod.images?.length ?? 0}`,
      );
    }
    for (const [i, img] of mod.images.entries()) {
      const specImg = spec.images[i];
      if (img.slot !== specImg.slot) {
        throw new AgentError(CODES.E_SCHEMA_INVALID, `${where}: ${mod.moduleId} 第 ${i + 1} 张 slot 应为 ${specImg.slot}`);
      }
      const size = Array.isArray(img.size) ? img.size : null;
      if (!size || size[0] !== specImg.size[0] || size[1] !== specImg.size[1]) {
        throw new AgentError(
          CODES.E_SCHEMA_INVALID,
          `${where}: ${mod.moduleId}/${img.slot} 尺寸应为 ${specImg.size[0]}x${specImg.size[1]}`,
        );
      }
      if (!img.shotBrief || String(img.shotBrief).length < 10) {
        throw new AgentError(CODES.E_SCHEMA_INVALID, `${where}: ${mod.moduleId}/${img.slot} 缺少 shotBrief`);
      }
    }
    const headline = String(mod.copy?.headline ?? "").trim();
    if (headline) {
      if (headline.length > 200) throw new AgentError(CODES.E_SCHEMA_INVALID, `${where}: ${mod.moduleId} 标题过长`);
      if (/\?|？/.test(headline) && !/^(how|why|what|can|does|which|where|when|who|is|are|do)\b/i.test(headline)) {
        throw new AgentError(CODES.E_SCHEMA_INVALID, `${where}: ${mod.moduleId} 标题是问句但不是买家口吻问句`);
      }
    }
    const banned = /最便宜|最低价|折扣|优惠|限时|仅剩|最好的|best seller|cheap(est)?\b|discount|sale|limited time/i;
    const copyText = JSON.stringify(mod.copy ?? {});
    if (banned.test(copyText)) {
      throw new AgentError(CODES.E_SCHEMA_INVALID, `${where}: ${mod.moduleId} 文案命中合规红线`);
    }
  }
  if (!plan.modules.some((m) => m.moduleId === "hero-banner")) {
    throw new AgentError(CODES.E_SCHEMA_INVALID, `${where}: 必须包含 hero-banner`);
  }
  return plan;
}

/** 展开成逐图任务清单 */
export function expandAplusPlan(plan) {
  const tasks = [];
  plan.modules.forEach((mod, moduleIndex) => {
    for (const img of mod.images) {
      tasks.push({
        moduleId: mod.moduleId,
        moduleIndex,
        slot: img.slot,
        size: img.size,
        shotBrief: img.shotBrief,
        sellingPointQuestion: img.sellingPointQuestion ?? "",
        focus: img.focus ?? "",
        copy: mod.copy ?? {},
        why: mod.why ?? "",
        // 同类型模块可能出现多次（Amazon 允许多个三图模块），文件名必须带序号才不会互相覆盖
        fileName: `${String(moduleIndex + 1).padStart(2, "0")}-${mod.moduleId}__${img.slot}.jpg`,
      });
    }
  });
  return tasks;
}

/** 出图 prompt：严格按模块尺寸 + 讲一件事 + 图内不写字 */
export function buildAplusImagePrompt(task, { skuLock = "", globalRules = {} } = {}) {
  const [w, h] = task.size;
  const lines = [
    `Generate ONE image for an Amazon A+ Content module.`,
    `Exact canvas: ${w}x${h} pixels, aspect ${w}:${h}. Do not letterbox or pad.`,
    `What this image must show: ${task.shotBrief}`,
  ];
  if (task.focus) lines.push(`Composition: ${task.focus}`);
  if (task.sellingPointQuestion) {
    lines.push(`This image answers the buyer's question: "${task.sellingPointQuestion}" — make the answer visible in the picture.`);
  }
  if (skuLock) lines.push(`SKU lock — ${skuLock.replace(/\n/g, " ")}`);
  lines.push(
    "This image carries NO text: no words, no letters, no numbers, no logo overlay, no watermark, no border. Copy lives in Amazon's text fields, not in the pixels.",
  );
  lines.push("Keep the product exactly as in the uploaded reference photo: same shape, same colors, same structure.");
  if (globalRules.mobileFirst) {
    lines.push("Design for a phone screen: one clear subject, high contrast, no clutter.");
  }
  return lines.join("\n");
}

/** 把成图裁/缩到模块要求的精确像素（等比缩放后补白边，绝不拉伸变形） */
export async function toExactSize(file, [w, h]) {
  const py = (await resolvePython()) ?? null;
  if (!py) return { ok: false, reason: "pillow-unavailable" };
  try {
    const { stdout } = await execFileP(py, [EXACT_SCRIPT, file, String(w), String(h)], { timeout: 60_000 });
    return JSON.parse(stdout.trim().split("\n").pop());
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
}


/** S_A+1：生成套图设计说明（模块编排 + 问句卖点） */
export async function buildAplusPlan({ model, catalog, factsText, skuLock = "" }) {
  const template = await loadPrompt("05_a_plus_design.md");
  const prompt = fill(template, {
    MODULE_CATALOG: catalogForPrompt(catalog),
    ORDER_RULES: catalog.orderRationale.map((r, i) => `${i + 1}. ${r}`).join("\n"),
    SELECTION_RULES: catalog.selectionRules.map((r) => `- ${r}`).join("\n"),
    GLOBAL_RULES: [
      `- 图内文字：${catalog.globalRules.textInPixels}`,
      ...catalog.globalRules.banned.map((b) => `- 禁止：${b}`),
      `- ${catalog.globalRules.mobileFirst}`,
      `- ${catalog.globalRules.noGalleryReuse}`,
    ].join("\n"),
    FACTS_TEXT: factsText,
    QUESTION_STYLE: `每个卖点标题必须是买家会问出口的问句（${catalog.questionStyle.rule}）。示例：${catalog.questionStyle.example}`,
    SKU_LOCK: skuLock,
  });
  return model.askJson({
    label: "a-plus-design",
    prompt,
    profile: "planning",
    validate: (json) => validateAplusPlan(json, catalog),
  });
}

/** S_A+3：模块级验收（图是否讲对该件事 + 图内是否无文字） */
const QC_PROMPT = `You audit one image destined for an Amazon A+ Content module.
Return JSON only:
{
  "showsIntendedContent": true,
  "bannedTextInPixels": false,
  "textFound": [],
  "productMatchesReference": true,
  "mobileLegible": true,
  "issues": []
}
Module: {{MODULE}}
Module purpose: {{WHY}}
Image brief that was requested: {{BRIEF}}
Buyer's question this image answers: {{QUESTION}}
Attachment 1 = generated image, attachment 2 = product reference photo.
Judge only what is visible. If unsure, mark false. No suggestions, no rewrites.`;

export async function runAplusQc({ model, task, imageFile, referenceFile, catalog }) {
  const spec = catalog.modules[task.moduleId];
  const prompt = QC_PROMPT.replace("{{MODULE}}", `${task.moduleId}｜${spec.label}｜slot ${task.slot}｜${task.size[0]}x${task.size[1]}px`)
    .replace("{{WHY}}", task.why || spec.copyHint)
    .replace("{{BRIEF}}", task.shotBrief)
    .replace("{{QUESTION}}", task.sellingPointQuestion || "-");
  const attachments = [imageFile, referenceFile].filter(Boolean);
  await model.openPlanningChat(attachments);
  const result = await model.askJson({
    label: `a-plus-qc-${task.moduleId}-${task.slot}`,
    prompt: `${prompt}

---
第 1 张=成图，第 2 张=产品参考图。`,
    profile: "identify",
    validate: (json) => {
      if (typeof json.showsIntendedContent !== "boolean") throw new Error("showsIntendedContent 必须是布尔");
      if (typeof json.bannedTextInPixels !== "boolean") throw new Error("bannedTextInPixels 必须是布尔");
    },
  });
  const pass = result.showsIntendedContent && !result.bannedTextInPixels && result.productMatchesReference !== false;
  return { ...result, verdict: pass ? "pass" : "fail" };
}
