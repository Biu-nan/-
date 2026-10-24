// agents/_shared/permissions.js
// 权限级与范围守卫。P3+ 副作用在代码里强制，不靠 prompt 约束。

import path from "node:path";
import { AgentError, CODES } from "./errors.js";

export const PERMISSIONS = {
  FS_READ: "P1",
  NET_READ: "P2",
  FS_WRITE: "P3",
  MODEL_CALL: "P4", // 外部模型调用（有成本）
  DATA_EGRESS: "P5", // 把产品图/资料上传到外部服务
  DESTRUCTIVE: "P6",
};

/** 允许本 Agent 使用的最高权限；出现 P6 一律拒绝 */
export const ALLOWED_MAX = PERMISSIONS.DATA_EGRESS;

const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();

/** 目标路径必须在 root 之内（含 root 本身） */
export function assertWithin(root, target, label = "write") {
  const r = norm(root);
  const t = norm(target);
  if (t !== r && !t.startsWith(r.endsWith("/") ? r : r + "/")) {
    throw new AgentError(CODES.SCOPE_VIOLATION, `越界${label}被拒绝：${target} 不在 ${root} 内`, {
      root,
      target,
    });
  }
  return path.resolve(target);
}

export function assertPermission(tier) {
  if (tier === PERMISSIONS.DESTRUCTIVE) {
    throw new AgentError(CODES.SCOPE_VIOLATION, "本 Agent 禁止任何 P6 破坏性动作", { tier });
  }
}

// 敏感字段：绝不外发给模型。命中键名或中文词即整键剔除，并留取证记录。
const SENSITIVE_KEY = /(supplier|vendor|factory|cost|profit|margin|佣金|成本|采购|进价|利润|供应商|工厂|毛利)/i;

export function sanitizeFacts(input, { pathPrefix = "$" } = {}) {
  const redacted = [];
  const walk = (value, keyPath) => {
    if (Array.isArray(value)) {
      return value.map((item, index) => walk(item, `${keyPath}[${index}]`));
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        const nextPath = `${keyPath}.${key}`;
        if (SENSITIVE_KEY.test(key)) {
          redacted.push(nextPath);
          continue;
        }
        out[key] = walk(item, nextPath);
      }
      return out;
    }
    return value;
  };
  const facts = walk(input, pathPrefix);
  return { facts, redacted };
}
