// agents/ae-product-design/src/vision-identify.js
// S1.5：本地视觉识别。把「看图」从云端配额里拿出来，同时锁定目标 SKU，
// 避免参考图含多款时模型挑错货（实测曾把胡萝卜画成番茄）。
// 依赖本机 Ollama（默认 qwen3-vl:2b），不可用时静默降级，不阻断主流程。

import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const PREVIEW_SCRIPT = path.join(import.meta.dirname, "preview.py");
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const VISION_MODEL = process.env.VISION_MODEL ?? "qwen3-vl:2b";
const MAX_IMAGES = 3;
const PER_IMAGE_TIMEOUT_MS = 90_000;

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
      /* 试下一个 */
    }
  }
  pythonCache = null;
  return null;
}

const PROMPT = `You are given one product photo. Describe only what is visibly certain.
Return JSON with exactly these keys:
{
  "productType": "what the object is, short English noun phrase",
  "variantsSeen": ["each distinct SKU/variant visible, lowercase English, e.g. carrot, tomato"],
  "dominantVariant": "the variant that occupies the largest area",
  "colors": ["dominant product colors in English"],
  "structure": ["visible structural parts, e.g. three green leaves, two white eyes, terracotta pot"],
  "materialHints": ["visible material or process hints, e.g. 3d printed layer lines, matte plastic"],
  "has3dPrintLayers": true,
  "background": "white / light gray / wooden desk / ...",
  "textOnImage": ["transcribe any text you can read, keep original language"],
  "shotType": "one of full | macro | lifestyle | diagram | flatlay",
  "confidence": "high | medium | low"
}
Do not guess dimensions or prices. If unsure, use low confidence.`;

async function ollamaAvailable() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return false;
    const data = await response.json();
    return (data.models ?? []).some((m) => String(m.name).startsWith(VISION_MODEL.split(":")[0]));
  } catch {
    return false;
  }
}

async function describeImage(python, file, workDir, index) {
  const preview = path.join(workDir, `preview_${index}.jpg`);
  await execFileP(python, [PREVIEW_SCRIPT, file, preview, "768"], { timeout: 60_000 });
  const base64 = (await readFile(preview)).toString("base64");
  const startedAt = Date.now();
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{ role: "user", content: PROMPT, images: [base64] }],
      stream: false,
      // qwen3 系列是思考模型：不加 think:false 会把 token 全用在 reasoning 上
      think: false,
      format: "json",
      options: { num_predict: 500, temperature: 0 },
      signal: AbortSignal.timeout(PER_IMAGE_TIMEOUT_MS),
    }),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const payload = await response.json();
  // think:false + format:json 时，部分版本把结果放在 thinking 而不是 content
  const raw = String(payload.message?.content || payload.message?.thinking || "").trim();
  if (!raw) throw new Error("Ollama 返回空内容");
  return { parsed: JSON.parse(raw), elapsedMs: Date.now() - startedAt, preview };
}

const uniq = (list) => [...new Set((list ?? []).map((v) => String(v).trim()).filter(Boolean))];

/** 从标题里挑出命中的变体名（carrot / tomato ...） */
function matchTargetVariant(title, variants) {
  const lower = String(title ?? "").toLowerCase();
  const hit = variants.find((v) => {
    const token = v.toLowerCase().split(/[\s(（,，]/)[0];
    return token.length > 2 && lower.includes(token);
  });
  return hit ?? null;
}

/**
 * 返回 { available, model, targetVariant, forbiddenVariants, attributes, perImage }
 * 任何失败都返回 available=false，由调用方决定是否继续。
 */
export async function identifyProduct({ images = [], title = "", workDir, tracer }) {
  const empty = { available: false, model: VISION_MODEL, targetVariant: null, forbiddenVariants: [], attributes: {} };
  if (images.length === 0) return { ...empty, reason: "no-images" };
  if (!(await ollamaAvailable())) return { ...empty, reason: "ollama-unavailable" };
  const python = await resolvePython();
  if (!python) return { ...empty, reason: "pillow-unavailable" };

  await mkdir(workDir, { recursive: true });
  const picked = images.slice(0, MAX_IMAGES);
  const perImage = [];
  const errors = [];

  for (const [index, file] of picked.entries()) {
    try {
      const result = await describeImage(python, file, workDir, index);
      perImage.push({
        file: path.basename(file),
        viaIndex: index,
        ...result.parsed,
        elapsedMs: result.elapsedMs,
      });
      await tracer?.write("tool.called", {
        tool_call: { name: "ollama.vision", model: VISION_MODEL, image: path.basename(file) },
        output_summary: {
          variantsSeen: result.parsed.variantsSeen,
          shotType: result.parsed.shotType,
          confidence: result.parsed.confidence,
        },
        validation: { ok: true },
      });
    } catch (error) {
      errors.push({ file: path.basename(file), error: error?.message ?? String(error) });
    }
  }

  if (perImage.length === 0) {
    return { ...empty, reason: "all-images-failed", errors };
  }

  const variants = uniq(perImage.flatMap((i) => i.variantsSeen ?? []));
  const dominant = perImage.find((i) => i.dominantVariant)?.dominantVariant ?? null;
  const targetVariant = matchTargetVariant(title, variants) ?? dominant ?? null;
  const targetKey = String(targetVariant ?? "").toLowerCase();
  const forbidden = targetVariant
    ? variants.filter((v) => v.toLowerCase() !== targetKey)
    : [];

  // 只保留「含目标 SKU」的参考图，且主导变体是目标的排最前。
  // 这是防货不对板的关键：参考集里常有其它 SKU 的图，不能一起喂给出图模型。
  const containing = perImage.filter((i) =>
    (i.variantsSeen ?? []).some((v) => String(v).toLowerCase() === targetKey),
  );
  const ranked = (containing.length ? containing : perImage).sort((a, b) => {
    const rank = (item) => (String(item.dominantVariant ?? "").toLowerCase() === targetKey ? 0 : 1);
    return rank(a) - rank(b);
  });
  const referenceFiles = ranked.slice(0, 2).map((i) => path.join(path.dirname(images[i.viaIndex]), i.file));

  // 属性只从目标 SKU 的图里汇总，避免把别的款的颜色/结构带进来
  const attrSource = containing.length ? containing : perImage;
  return {
    available: true,
    model: VISION_MODEL,
    targetVariant,
    forbiddenVariants: forbidden,
    referenceFiles,
    excludedFiles: perImage
      .filter((i) => !ranked.slice(0, 2).includes(i))
      .map((i) => i.file),
    attributes: {
      productType: attrSource.find((i) => i.productType)?.productType ?? null,
      colors: uniq(attrSource.flatMap((i) => i.colors ?? [])),
      structure: uniq(attrSource.flatMap((i) => i.structure ?? [])),
      materialHints: uniq(attrSource.flatMap((i) => i.materialHints ?? [])),
      has3dPrintLayers: attrSource.some((i) => i.has3dPrintLayers === true),
      textOnImage: uniq(attrSource.flatMap((i) => i.textOnImage ?? [])),
      backgrounds: uniq(attrSource.map((i) => i.background)),
    },
    perImage,
    errors,
    reason: errors.length ? "partial" : null,
  };
}

/** 给模型读的「目标 SKU 锁」文本 */
export function buildSkuLockText(vision) {
  if (!vision?.available || !vision.targetVariant) return "";
  const lines = [`目标 SKU：${vision.targetVariant}（本次只允许这一款）`];
  if (vision.forbiddenVariants.length) {
    lines.push(`禁止出现的其它 SKU：${vision.forbiddenVariants.join(", ")}`);
  }
  const attrs = vision.attributes ?? {};
  if (attrs.structure?.length) lines.push(`必须保持一致的结构：${attrs.structure.join("；")}`);
  if (attrs.colors?.length) lines.push(`产品主色：${attrs.colors.join(", ")}`);
  if (attrs.materialHints?.length) lines.push(`材质/工艺观感：${attrs.materialHints.join("；")}`);
  return lines.join("\n");
}

/**
 * 本地审计：给已生成的成图打 SKU / 镜头类型 / 文字 三个标签。
 * 不占云端附件配额，可作为云端 QC 的兜底或交叉验证。
 */
const AUDIT_PROMPT = `You are auditing one generated e-commerce image.
Compare it with the reference photo provided.
Return JSON with exactly these keys:
{
  "sku": "the variant you see in the generated image, lowercase English noun",
  "isTargetSku": true,
  "shotType": "full | macro | lifestyle | diagram | flatlay",
  "hasText": false,
  "textFound": ["any text you can read, keep original language"],
  "isWhiteBackground": true,
  "notes": "short factual note"
}
TARGET SKU: {sku}
EXPECTED SHOT TYPE: {shot}
Reference photo is attachment 2; generated image is attachment 1.`;

export async function auditImage({ generatedFile, referenceFile, targetSku = "", expectedShot = "any", workDir }) {
  const python = await resolvePython();
  if (!python) return { available: false, reason: "pillow-unavailable" };
  if (!(await ollamaAvailable())) return { available: false, reason: "ollama-unavailable" };
  await mkdir(workDir, { recursive: true });
  const toBase64 = async (file, tag) => {
    const preview = path.join(workDir, `audit_${tag}.jpg`);
    await execFileP(python, [PREVIEW_SCRIPT, file, preview, "768"], { timeout: 60_000 });
    return (await readFile(preview)).toString("base64");
  };
  const generated = await toBase64(generatedFile, "gen");
  const reference = referenceFile ? await toBase64(referenceFile, "ref") : null;
  const prompt = AUDIT_PROMPT.replace("{sku}", targetSku || "the product in the reference").replace(
    "{shot}",
    expectedShot,
  );
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{ role: "user", content: prompt, images: reference ? [generated, reference] : [generated] }],
      stream: false,
      think: false,
      format: "json",
      options: { num_predict: 400, temperature: 0 },
      signal: AbortSignal.timeout(PER_IMAGE_TIMEOUT_MS),
    }),
  });
  if (!response.ok) return { available: false, reason: `ollama-http-${response.status}` };
  const payload = await response.json();
  const raw = String(payload.message?.content || payload.message?.thinking || "").trim();
  if (!raw) return { available: false, reason: "empty-response" };
  try {
    const parsed = JSON.parse(raw);
    return {
      available: true,
      sku: parsed.sku ?? null,
      isTargetSku: targetSku
        ? String(parsed.sku ?? "").toLowerCase().includes(String(targetSku).toLowerCase())
        : Boolean(parsed.isTargetSku),
      shotType: parsed.shotType ?? null,
      shotMatch: expectedShot === "any" ? true : String(parsed.shotType ?? "").toLowerCase() === expectedShot,
      hasText: Boolean(parsed.hasText),
      textFound: parsed.textFound ?? [],
      isWhiteBackground: parsed.isWhiteBackground,
      notes: parsed.notes ?? "",
    };
  } catch (error) {
    return { available: false, reason: `json-parse: ${error.message}` };
  }
}
