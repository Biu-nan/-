// agents/_shared/trace.js
// OTel GenAI 风格的 JSONL 事件流。默认不落 prompt 正文与图片二进制。

import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

export class Tracer {
  constructor({ file, runId, agentId, principal, delegatedBy, captureContent = false }) {
    this.file = file;
    this.runId = runId;
    this.traceId = runId;
    this.agentId = agentId;
    this.principal = principal;
    this.delegatedBy = delegatedBy;
    this.captureContent = captureContent;
    this.parentEventId = undefined;
    this.modelCalls = 0;
    this.imageGenerations = 0;
  }

  async write(eventType, payload = {}) {
    const record = {
      trace_id: this.traceId,
      run_id: this.runId,
      agent_id: this.agentId,
      agent_principal: this.principal,
      delegated_by: this.delegatedBy,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      parent_event_id: this.parentEventId,
      ...payload,
    };
    if (payload.prompt) {
      record.prompt_sha256 = sha256(payload.prompt);
      record.prompt_excerpt = this.captureContent ? payload.prompt : String(payload.prompt).slice(0, 120);
      delete record.prompt;
    }
    try {
      await mkdir(path.dirname(this.file), { recursive: true });
      await appendFile(this.file, JSON.stringify(record) + "\n", "utf8");
    } catch (error) {
      // 追踪失败不能打断主流程，但必须打到 stderr 留痕
      console.error(`[trace] 写入失败：${error?.message ?? error}`);
    }
    return record;
  }

  async llmCalled({ label, model, elapsedMs, promptChars, outputChars, ok = true, error }) {
    this.modelCalls += 1;
    return this.write("llm.called", {
      input_summary: { label, promptChars },
      model,
      output_summary: { outputChars },
      validation: { ok },
      error: error ? { code: error.code, message: error.message } : undefined,
      tool_call: { name: "chatgpt.structured", duration_ms: elapsedMs },
    });
  }

  async imageGenerated({ slotId, attempt, file, elapsedMs, bytes }) {
    this.imageGenerations += 1;
    return this.write("tool.called", {
      tool_call: { name: "chatgpt.image", slotId, attempt, duration_ms: elapsedMs },
      output_summary: { file, bytes },
    });
  }
}
