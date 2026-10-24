// agents/ae-product-design/src/image-tools.js
// Pillow 缩略图：把「160×160 缩略图还能不能认出来」从主观猜测变成可喂给视觉模型的真实素材。

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

const execFileP = promisify(execFile);
const THUMB_SCRIPT = path.join(import.meta.dirname, "thumb.py");

const PYTHON_CANDIDATES = [
  process.env.WORKBUDDY_PYTHON,
  path.join(os.homedir(), ".workbuddy", "binaries", "python", "envs", "default", "Scripts", "python.exe"),
  "python3",
  "python",
].filter(Boolean);

let pythonCache;

export async function resolvePython() {
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

/** 生成缩略图，返回 {file, inner} 或 null（无 Pillow 时降级，不阻断主流程） */
export async function makeThumbnail(srcFile, dstFile, size = 160) {
  const python = await resolvePython();
  if (!python) return null;
  try {
    await mkdir(path.dirname(dstFile), { recursive: true });
    const { stdout } = await execFileP(python, [THUMB_SCRIPT, srcFile, dstFile, String(size)], { timeout: 60_000 });
    return { file: dstFile, size, inner: stdout.trim() };
  } catch (error) {
    console.warn(`[thumb] 生成失败，跳过移动端可识别性检验：${error?.message ?? error}`);
    return null;
  }
}

const FIT_SCRIPT = path.join(import.meta.dirname, "fit_scale.py");

/** 把 "70%-85%" 解析为 [0.7, 0.85]；无法解析返回 null */
export function parseScaleRange(text) {
  const matches = String(text ?? "").match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const nums = matches.map(Number).map((n) => (n > 1 ? n / 100 : n)).filter((n) => n > 0 && n <= 1);
  if (nums.length === 0) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max, target: Number(((min + max) / 2).toFixed(3)) };
}

/**
 * 纯白底图的主体占比校正（确定性，非模型）。
 * 超过上限时扩画布补白到目标占比；非白底图自动跳过，不会造出假白边。
 */
export async function fitSubjectScale(file, { min = 0.7, max = 0.85, target = 0.78 } = {}) {
  const python = await resolvePython();
  if (!python) return null;
  try {
    const { stdout } = await execFileP(
      python,
      [FIT_SCRIPT, file, String(min), String(max), String(target)],
      { timeout: 60_000 },
    );
    return JSON.parse(stdout.trim().split("\n").pop());
  } catch (error) {
    console.warn(`[fit] 主体占比校正失败（保留原图）：${error?.message ?? error}`);
    return null;
  }
}
