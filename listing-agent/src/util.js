// 共享工具：JSON 提取、深合并、日志。
import { jsonrepair } from "jsonrepair";

/**
 * 从 AI 文本中提取 JSON 对象（兼容 ```json 代码块与裸 JSON）。
 * @param {string} text
 * @returns {object}
 */
export function extractJson(text) {
  if (!text) throw new Error("AI 未返回内容");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced
    ? fenced[1]
    : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate || !candidate.trim()) throw new Error("未在 AI 回复中找到 JSON");
  return JSON.parse(jsonrepair(candidate.trim()));
}

/**
 * 浅+一层合并：把 overrides 合并进 base（数组/对象覆盖，不递归深炸）。
 * @param {object} base
 * @param {object} overrides
 * @returns {object}
 */
export function deepMerge(base, overrides) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!overrides || typeof overrides !== "object") return out;
  for (const k of Object.keys(overrides)) {
    const v = overrides[k];
    if (
      v && typeof v === "object" && !Array.isArray(v) &&
      out[k] && typeof out[k] === "object" && !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * 简单过程日志收集器。
 */
export class Log {
  constructor() { this.lines = []; }
  push(stage, msg) { this.lines.push(`[${stage}] ${msg}`); }
  all() { return this.lines.slice(); }
}
