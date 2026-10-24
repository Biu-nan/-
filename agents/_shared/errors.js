// agents/_shared/errors.js
// 结构化错误：每个失败都有稳定错误码，便于 eval 断言与升级判定。

export const CODES = {
  INPUT_INVALID: "E_INPUT_INVALID",
  INPUT_IMAGES: "E_INPUT_IMAGES",
  SCOPE_VIOLATION: "E_SCOPE_VIOLATION",
  SCHEMA_INVALID: "E_SCHEMA_INVALID",
  RESEARCH_EMPTY: "E_RESEARCH_EMPTY",
  MODEL_JSON: "E_MODEL_JSON",
  MODEL_UNAVAILABLE: "E_MODEL_UNAVAILABLE",
  IMAGE_TOOL_UNAVAILABLE: "E_IMAGE_TOOL_UNAVAILABLE",
  IMAGE_TIMEOUT: "E_IMAGE_TIMEOUT",
  UPLOAD_UNAVAILABLE: "E_UPLOAD_UNAVAILABLE",
  QC_FAILED: "E_QC_FAILED",
  BUDGET_EXCEEDED: "E_BUDGET_EXCEEDED",
  APPROVAL_REQUIRED: "E_APPROVAL_REQUIRED",
  GATE_REJECTED: "E_GATE_REJECTED",
  UNKNOWN: "E_UNKNOWN",
};

export class AgentError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.details = details;
  }
  toPayload() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function asAgentError(error, fallbackCode = CODES.UNKNOWN) {
  if (error instanceof AgentError) return error;
  const wrapped = new AgentError(fallbackCode, error?.message ?? String(error), {
    raw: error?.stack ? String(error.stack).split("\n").slice(0, 4).join(" | ") : undefined,
  });
  return wrapped;
}

export function isFatal(error) {
  const code = error?.code;
  return [
    CODES.INPUT_INVALID,
    CODES.INPUT_IMAGES,
    CODES.SCOPE_VIOLATION,
    CODES.MODEL_UNAVAILABLE,
    CODES.IMAGE_TOOL_UNAVAILABLE,
    CODES.BUDGET_EXCEEDED,
    CODES.GATE_REJECTED,
    CODES.APPROVAL_REQUIRED,
  ].includes(code);
}
