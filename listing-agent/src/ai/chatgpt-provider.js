// ChatGptWebProvider：唯一 AI 实现，直接复用现有 dist/src/chatgpt-adapter.js（网页版 ChatGPT）。
// 文本：uploadImages + sendPromptOnce + waitForResponseAfterPrompt。
// 生图：enableImageCreation + 逐张 sendPromptOnce + waitForGeneratedImageAndDownload。
//
// ⚠️ 运行时依赖：本机需常驻一只已登录的 Chrome（CDP :9223）。无头/未登录时 generateText/generateImage
//   会明确抛错（来自 chatgpt-adapter 的健康检查），不会静默失败。这是「仅网页版」决策的固有约束。
import path from "node:path";
import { ChatGptAdapter } from "../../../dist/src/chatgpt-adapter.js";
import { OUTPUT_DIR, MODEL_PROFILES } from "../../../dist/src/config.js";

export class ChatGptWebProvider {
  /**
   * @param {object} [opts]
   * @param {object} [opts.adapter] 注入 ChatGptAdapter（便于测试）
   * @param {string} [opts.outputDir] 生图输出目录，默认 config.OUTPUT_DIR
   * @param {number} [opts.imageCount] 每次生图张数（默认 6）
   */
  constructor(opts = {}) {
    this.adapter = opts.adapter || new ChatGptAdapter();
    this.outputDir = opts.outputDir || OUTPUT_DIR;
    this.imageCount = opts.imageCount || 6;
    this.modelProfile = MODEL_PROFILES.image;
  }

  async generateText(prompt, fingerprint, ctx = {}) {
    await this.adapter.launch();
    if (ctx.images && ctx.images.length) {
      await this.adapter.uploadImages(ctx.images);
    }
    await this.adapter.sendPromptOnce(prompt, fingerprint, {});
    const text = await this.adapter.waitForResponseAfterPrompt(fingerprint);
    return { text };
  }

  async generateImage(prompt, fingerprint, ctx = {}) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(this.outputDir, { recursive: true });
    await this.adapter.launch();
    // 关键修复：生图前必须上传参考图，否则 ChatGPT 看不到参考、会凭空生成默认色 = 货不对版
    if (ctx.images && ctx.images.length) {
      await this.adapter.uploadImages(ctx.images);
    }
    await this.adapter.enableImageCreation();

    const page = await this.adapter.requirePage();
    const images = [];
    for (let i = 1; i <= this.imageCount; i++) {
      const tag = String(i).padStart(2, "0");
      const previousCount = await this.adapter.generatedImages(page).count();
      const perPrompt = `${prompt}\n请生成 Image_${tag}`;
      const outPath = path.join(this.outputDir, `Image_${tag}.png`);
      await this.adapter.sendPromptOnce(perPrompt, fingerprint, {
        model: this.modelProfile.model,
        reasoning: this.modelProfile.reasoning,
      });
      // waitForGeneratedImageAndDownload 把最新生成图存到 outPath（返回 undefined）。
      await this.adapter.waitForGeneratedImageAndDownload(previousCount, outPath);
      images.push(outPath);
    }
    return { images };
  }
}
