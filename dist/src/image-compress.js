// 图片自动压缩辅助：在一跨网站生产完图片、保存本地时调用。
// 用受管 Python venv 的 Pillow 把图片压到 <= maxKB（默认 200），
// 仅压缩体积、不改尺寸/内容；用户选择 jpg 输出，透明背景填白。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPRESS_SCRIPT = path.join(__dirname, "compress_image.py");

// 候选 Python：优先受管 venv（已装 Pillow），其次 PATH 上的 python。
const PYTHON_CANDIDATES = [
  process.env.WORKBUDDY_PYTHON,
  path.join(os.homedir(), ".workbuddy", "binaries", "python", "envs", "default", "Scripts", "python.exe"),
  "python3",
  "python",
].filter(Boolean);

let _pythonCache;
async function resolvePython() {
  if (_pythonCache !== undefined) return _pythonCache;
  for (const cand of PYTHON_CANDIDATES) {
    try {
      await execFileP(cand, ["-c", "import PIL"], { timeout: 10_000 });
      _pythonCache = cand;
      return cand;
    }
    catch {
      /* 尝试下一个候选 */
    }
  }
  _pythonCache = null;
  return null;
}

export async function compressGeneratedImage(filePath, maxKB = 200) {
  const py = await resolvePython();
  if (!py) {
    throw new Error("未找到带 Pillow 的 Python 运行时（compress_image.py 需要 Pillow）");
  }
  await execFileP(py, [COMPRESS_SCRIPT, filePath, String(maxKB)], { timeout: 60_000 });
}
