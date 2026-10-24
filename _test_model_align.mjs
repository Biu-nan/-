// E2E：用真实 ChatGptAdapter 代码验证模型/推理对齐（三轮）
import { chromium } from "playwright-core";
import { ChatGptAdapter } from "./dist/src/chatgpt-adapter.js";

const pillOf = async (page) =>
  ((await page.locator('button[aria-label="选择 ChatGPT 模型"]').first().textContent().catch(() => "?")) || "").trim();

const run = async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const page = browser.contexts()[0].pages()[0];
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(500);

  const a = new ChatGptAdapter();
  a.page = page;

  const cases = [
    { label: "① 同状态应跳过", model: "GPT-5.6 Sol", reasoning: "高" },
    { label: "② 切到 GPT-6 + 中", model: "GPT-6", reasoning: "中" },
    { label: "③ 切回 GPT-5.6 Sol + 高", model: "GPT-5.6 Sol", reasoning: "高" },
    { label: "④ 低档归一化→即时", model: "GPT-6", reasoning: "低" },
    { label: "⑤ 复位 GPT-5.6 Sol + 高", model: "GPT-5.6 Sol", reasoning: "高" },
  ];

  for (const c of cases) {
    a._ensuredModelConv = null; // 清缓存，强制真实走一遍
    a._ensuredModel = null;
    a._ensuredReasoning = null;
    console.log(`\n===== ${c.label} =====`);
    console.log("前:", await pillOf(page));
    const t0 = Date.now();
    await a.ensureChatGptModelAndReasoning(page, { model: c.model, reasoning: c.reasoning });
    console.log("后:", await pillOf(page), `| 耗时 ${Date.now() - t0}ms`, "| 内部标记 ok=", a._ensuredModelOk);
  }

  await browser.close().catch(() => {});
};
run().catch((e) => console.error("FATAL:", e.message));
