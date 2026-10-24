// agents/ae-product-design/src/model.js
// 唯一与外部模型交互的出口：结构化 JSON 调用 + 图片生成。
// 复用现有 ChatGptAdapter（CDP :9223），不新建账号、不带独立凭据。

import path from "node:path";
import { jsonrepair } from "jsonrepair";
import { ChatGptAdapter } from "../../../dist/src/chatgpt-adapter.js";
import { MODEL_PROFILES } from "../../../dist/src/config.js";
import { AgentError, CODES } from "../../_shared/errors.js";

/** 从模型回复中提取 JSON：去围栏 → 首尾括号配对 → jsonrepair 兜底 */
export function extractJson(text) {
  if (!text || typeof text !== "string") throw new AgentError(CODES.MODEL_JSON, "模型无回复内容");
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  const firstBrace = body.search(/[[{]/);
  if (firstBrace < 0) throw new AgentError(CODES.MODEL_JSON, "回复中找不到 JSON 起点");
  const openChar = body[firstBrace];
  const closeChar = openChar === "{" ? "}" : "]";
  const lastIndex = body.lastIndexOf(closeChar);
  if (lastIndex <= firstBrace) throw new AgentError(CODES.MODEL_JSON, "回复中 JSON 未闭合（疑似截断）");
  const candidate = body.slice(firstBrace, lastIndex + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch (error) {
      throw new AgentError(CODES.MODEL_JSON, `JSON 解析失败：${error?.message ?? error}`, {
        head: candidate.slice(0, 200),
      });
    }
  }
}

export class ModelClient {
  constructor({ tracer, agentId, dryRun = false }) {
    this.tracer = tracer;
    this.agentId = agentId;
    this.dryRun = dryRun;
    this.adapter = null;
    this.planningChatOpen = false;
  }

  async #ensure() {
    if (this.dryRun) throw new AgentError(CODES.MODEL_UNAVAILABLE, "dry-run 模式不应调用模型");
    if (!this.adapter) this.adapter = new ChatGptAdapter();
    await this.adapter.launch();
    return this.adapter;
  }

  async healthCheck() {
    const adapter = await this.#ensure();
    const health = await adapter.quickHealthCheck().catch((error) => ({ ok: false, reason: error?.message }));
    if (!health.ok) {
      throw new AgentError(CODES.MODEL_UNAVAILABLE, `ChatGPT 页面不可用：${health.reason ?? "未知"}`, health);
    }
    return health;
  }

  async openPlanningChat(refImages = []) {
    const adapter = await this.#ensure();
    await adapter.createBlankChat();
    this.planningChatOpen = true;
    if (refImages.length) {
      await adapter.uploadImages(refImages);
      await this.tracer.write("tool.called", {
        tool_call: { name: "chatgpt.upload", purpose: "style-refs", count: refImages.length },
      });
    }
  }

  /**
   * 结构化调用：发送 prompt → 等待回复 → 解析 JSON → schema 校验。
   * 校验失败会带上错误原因重问一次（同一会话，避免重建上下文）。
   */
  async askJson({ label, prompt, profile = "planning", validate, maxAttempts = 2 }) {
    const adapter = await this.#ensure();
    if (!this.planningChatOpen) await this.openPlanningChat();
    const modelProfile = MODEL_PROFILES[profile] ?? MODEL_PROFILES.planning;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      const fingerprint = `${label} · v1 · try${attempt} · ${Date.now()}`;
      const outbound =
        attempt === 1
          ? prompt
          : `${prompt}\n\n---\n上一次输出未通过校验：${lastError?.message ?? "未知"}。请严格按要求重新输出完整 JSON，不要解释、不要省略字段。`;
      try {
        await adapter.sendPromptOnce(outbound, fingerprint, modelProfile);
        const text = await adapter.waitForResponseAfterPrompt(fingerprint, {});
        const json = extractJson(text);
        if (typeof validate === "function") validate(json);
        await this.tracer.llmCalled({
          label,
          model: modelProfile.model,
          elapsedMs: Date.now() - startedAt,
          promptChars: outbound.length,
          outputChars: text.length,
        });
        return json;
      } catch (error) {
        lastError = error;
        await this.tracer.llmCalled({
          label,
          model: modelProfile.model,
          elapsedMs: Date.now() - startedAt,
          promptChars: outbound.length,
          outputChars: 0,
          ok: false,
          error: { code: error?.code ?? CODES.UNKNOWN, message: error?.message },
        });
        // 页面不可用 / 工具不可用这类错误重问无意义，直接冒泡
        if ([CODES.MODEL_UNAVAILABLE, CODES.IMAGE_TOOL_UNAVAILABLE].includes(error?.code)) throw error;
      }
    }
    throw lastError ?? new AgentError(CODES.MODEL_JSON, `${label} 多次未产出可用 JSON`);
  }

  /**
   * 单会话连续出图（A+ 套图用）：只开一个对话、只上传一次参考图，
   * 在同一会话里依次生成所有图。既省附件配额，也让整套图光源/色调更一致。
   */
  async generateImageSeries({ tasks, productImages, timeoutMs = 8 * 60_000 }) {
    const adapter = await this.#ensure();
    await this.healthCheck();

    let uploaded = null;
    let uploadError;
    const attempts = [productImages, productImages.slice(0, 1)].filter(
      (set, i, arr) => set.length > 0 && arr.findIndex((x) => x.length === set.length) === i,
    );
    for (const set of attempts) {
      for (let i = 0; i < 2 && !uploaded; i += 1) {
        try {
          await adapter.createBlankChat();
          await adapter.uploadImages(set);
          uploaded = set;
        } catch (error) {
          uploadError = error;
          await new Promise((resolve) => setTimeout(resolve, 4_000));
          await adapter.createBlankChat().catch(() => {});
        }
      }
      if (uploaded) break;
    }
    if (!uploaded) {
      throw new AgentError(CODES.UPLOAD_UNAVAILABLE, `参考图上传失败：${uploadError?.message ?? uploadError}`);
    }
    this.planningChatOpen = false;

    const results = [];
    for (const task of tasks) {
      const startedAt = Date.now();
      const before = await adapter.generatedImageCount();
      const fingerprint = `${task.slotId} · image · ${Date.now()}`;
      const guard = new Promise((_, reject) =>
        setTimeout(
          () => reject(new AgentError(CODES.IMAGE_TIMEOUT, `${task.slotId} 出图超时（单会话内）`)),
          timeoutMs,
        ),
      );
      try {
        await Promise.race([
          (async () => {
            await adapter.sendPromptOnce(task.prompt, fingerprint, MODEL_PROFILES.image);
            await adapter.waitForGeneratedImageAndDownload(before, task.outputPath);
          })(),
          guard,
        ]);
        await this.tracer.imageGenerated({
          slotId: task.slotId,
          attempt: 1,
          file: path.basename(task.outputPath),
          elapsedMs: Date.now() - startedAt,
        });
        results.push({ ...task, ok: true });
      } catch (error) {
        results.push({ ...task, ok: false, error: { code: error?.code ?? "E_UNKNOWN", message: String(error?.message ?? error).slice(0, 300) } });
      }
    }
    return results;
  }

  /**
   * 单槽位出图：每张图开新对话并重传产品参考图（避免单会话堆图卡死）。
   * 注意：2026-10 起 ChatGPT 新版 UI 已取消「创建图片 / DALL·E」composer 工具，
   * 生图改为模型自动路由。因此「启用工具」只作尽力而为且限时 20s，
   * 真正的判定标准是「有没有真的出图」——由 waitForGeneratedImageAndDownload 兜底。
   */
  async generateImage({ slotId, attempt, prompt, outputPath, productImages, timeoutMs = 8 * 60_000 }) {
    const adapter = await this.#ensure();
    await this.healthCheck();
    const startedAt = Date.now();
    await adapter.createBlankChat();
    this.planningChatOpen = false;
    // 快速换会话时「添加照片」入口偶发被禁用/限额，且多选入口常只吃进 1 张：
    // 依次降级尝试「全部产品图 → 仅首图」，仍失败才抛 E_UPLOAD_UNAVAILABLE。
    const attempts = [
      productImages,
      productImages.slice(0, 1),
    ].filter((set, i, arr) => set.length > 0 && arr.findIndex((s) => s.length === set.length) === i);
    let uploaded = null;
    let uploadError;
    for (const set of attempts) {
      for (let i = 0; i < 2 && !uploaded; i += 1) {
        try {
          await adapter.uploadImages(set);
          uploaded = set;
        } catch (error) {
          uploadError = error;
          await new Promise((resolve) => setTimeout(resolve, 4_000));
          await adapter.createBlankChat().catch(() => {});
        }
      }
      if (uploaded) break;
    }
    if (!uploaded) {
      throw new AgentError(CODES.UPLOAD_UNAVAILABLE, `产品图上传失败：${uploadError?.message ?? uploadError}`, {
        slotId,
        attempt,
      });
    }
    if (uploaded.length < productImages.length) {
      await this.tracer.write("guardrail.checked", {
        validation: { ok: true, degraded: "product-images", from: productImages.length, to: uploaded.length },
      });
    }

    const toolResult = await Promise.race([
      adapter
        .enableImageCreation()
        .then(() => ({ ok: true }))
        .catch((error) => ({ ok: false, error: error?.message ?? String(error) })),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "enable-image-creation 超时 20s" }), 20_000)),
    ]);
    if (!toolResult.ok) {
      await this.tracer.write("tool.called", {
        tool_call: { name: "chatgpt.enable-image-creation", slotId },
        validation: { ok: false, skipped: true },
        error: { message: String(toolResult.error).slice(0, 200) },
      });
      console.warn(`[${slotId}] 未能显式启用「创建图片」工具（新 UI 可能已内置），继续按出图结果判定`);
    }

    const before = await adapter.generatedImageCount();
    const fingerprint = `${slotId} · image · try${attempt} · ${Date.now()}`;
    const guard = new Promise((_, reject) =>
      setTimeout(() => reject(new AgentError(CODES.IMAGE_TIMEOUT, `${slotId} 出图超过 ${timeoutMs / 60000} 分钟`)), timeoutMs),
    );
    await Promise.race([
      (async () => {
        await adapter.sendPromptOnce(prompt, fingerprint, MODEL_PROFILES.image);
        await adapter.waitForGeneratedImageAndDownload(before, outputPath);
      })(),
      guard,
    ]);
    await this.tracer.imageGenerated({
      slotId,
      attempt,
      file: path.basename(outputPath),
      elapsedMs: Date.now() - startedAt,
    });
    return outputPath;
  }
}
