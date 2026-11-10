// agents/purchase-inventory/src/limits.js
// 权限上限的加载与执行。上限不是"建议"，超限必须改变输出形状，不许静默截断。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAtMost, SIDE_EFFECT_ORDER } from "../../../dist/src/agent-safety-scale.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LIMITS_FILE = path.join(HERE, "..", "config", "limits.json");

let cached = null;

export async function loadLimits(file = LIMITS_FILE) {
  if (cached && file === LIMITS_FILE) return cached;
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw);
  if (file === LIMITS_FILE) cached = parsed;
  return parsed;
}

/**
 * 按上限拆分建议量。
 * 规则：超单 SKU 上限时**均分**成多单，每单 ≤ 上限。
 * 明确不做：截断成 500（等于偷偷改需求）、原样输出（等于绕过上限）。
 */
export function splitQuantity(raw, maxPerSku) {
  const q = Math.max(0, Math.ceil(Number(raw) || 0));
  if (q === 0) return { orders: [], splitInto: 0 };
  if (q <= maxPerSku) return { orders: [q], splitInto: 1 };
  const n = Math.ceil(q / maxPerSku);
  const base = Math.floor(q / n);
  const remainder = q - base * n;
  const orders = Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
  return { orders, splitInto: n };
}

/**
 * 副作用等级守卫：走框架 §4.3 的唯一权威实现。
 *
 * 不用 agents/_shared/permissions.js 判等级 —— 那套 P 标号是「资源轴」，
 * 它的 FS_WRITE="P3" 在框架里对应的是「改平台草稿态」，拿它当"写本地"会放行最该拦的动作。
 */
export function assertSideEffectAllowed(level, limits) {
  const allowed = limits?.sideEffect?.allowed ?? ["P0", "P1"];
  const ceiling = allowed.reduce(
    (max, cur) => (SIDE_EFFECT_ORDER.indexOf(cur) > SIDE_EFFECT_ORDER.indexOf(max) ? cur : max),
    "P0",
  );
  return assertAtMost(level, ceiling, `本 Agent 只允许 ${allowed.join("/")}`);
}
