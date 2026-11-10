// dist/src/agent-shared/permissions.js
// 资源轴与范围守卫。
//
// 这里的 P 标号描述的是「资源/动作种类」，不是副作用严重度。
// 副作用等级的唯一权威定义在 dist/src/agent-safety-scale.js（框架 §4.3）：
// 越级、人批、不可逆一律走 assertAtMost / requiresHumanApproval / isIrreversible，
// 不要拿本文件的字面值做字符串比较（FS_WRITE="P3" 与框架 P3「改平台草稿态」不是一回事）。

import path from "node:path";
import { AgentError, CODES } from "./errors.js";

export const RESOURCE_AXIS = {
  FS_READ: "P1",
  NET_READ: "P2",
  FS_WRITE: "P3",
  MODEL_CALL: "P4", // 外部模型调用（有成本）
  DATA_EGRESS: "P5", // 把产品图/资料上传到外部服务
  DESTRUCTIVE: "P6",
};

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

// 副作用门不在这里：见 dist/src/agent-safety-scale.js 的 assertAtMost。

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
