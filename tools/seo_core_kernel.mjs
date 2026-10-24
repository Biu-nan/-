#!/usr/bin/env node
/**
 * 一跨而境 · Listing 生成「可移植内核」（仅 SEO 与商品文案）
 *
 * 特点：
 *   - 不 import 工作台任何模块、不依赖 3000 服务、不占用工作台单实例 —— 可整段搬进你自己的项目
 *   - 唯一依赖 playwright-core，通过 CDP 连接你已登录的 Chrome（ChatGPT 网页版）
 *   - 三轮对话：产品事实 → SEO 关键词 → Listing 文案，落盘 03_SEO_KEYWORDS.md / 04_LISTING_CONTENT.md
 *
 * 前置：
 *   chrome.exe --remote-debugging-port=9223 --user-data-dir=<你的 profile>
 *   并在该 Chrome 中登录 ChatGPT
 *
 * 用法：
 *   node tools/seo_core_kernel.mjs \
 *     --name "硅胶隐形乳贴" --category "女士内衣配件" \
 *     --notes "材质医用硅胶；直径8cm；2对装；目标市场美国" \
 *     --images "F:/a.jpg,F:/b.jpg" --out "F:/out"
 *
 * 环境变量：
 *   CDP=http://127.0.0.1:9223          Chrome 调试端口
 *   PROMPTS_DIR=F:/yikuaborder-deploy/prompts   03/04 提示词目录（可换成你自己的）
 */

import { chromium } from "playwright-core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CDP = process.env.CDP || "http://127.0.0.1:9223";
const PROMPTS_DIR = process.env.PROMPTS_DIR || path.resolve("prompts");
const RESPONSE_WAIT_MS = 22 * 60_000;   // 单轮回复上限（与工作台一致）
const STABLE_MS = 6000;                 // 文本稳定多久视为生成结束
const POLL_MS = 2000;

// 三个阶段的「指纹」：必须是 prompt 的首行，用于在页面中定位本轮消息，实现幂等与断点续跑
const FP_FACT = "# 产品图片事实提取";
const FP_SEO = "Google Ads SEO Keyword Research Prompt";
const FP_LISTING = "AliExpress Listing Commercial Delivery Prompt";

const FACT_PROMPT = `${FP_FACT}

你是跨境电商商品事实提取引擎。请基于我上传的产品图片（如有）与下方客观信息，输出该商品的事实底稿，供后续生成 SEO 关键词与 Listing 文案使用。

输出要求：
1. 只写能从图片或客观信息确认的事实；无法确认的写「待人工确认」，不要编造。
2. 覆盖：品名（中/英）、类目、材质、尺寸/规格、颜色、数量/套装、核心用途、使用场景、明显卖点、目标市场。
3. 用 Markdown 分节输出，不要输出 JSON，不要输出与事实无关的建议。`;

function parseArgs() {
  const a = { images: [] };
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i];
    const v = process.argv[++i];
    if (k === "--name") a.name = v;
    else if (k === "--category") a.category = v;
    else if (k === "--notes") a.notes = v;
    else if (k === "--images") a.images = String(v).split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--out") a.out = v;
    else if (k === "--chat-url") a.chatUrl = v;
  }
  if (!a.name) throw new Error("缺少 --name");
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 连接 Chrome 并取一个 page（复用已有标签页，不新开窗口） */
async function connect() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("chatgpt.com")) || (await ctx.newPage());
  return { browser, page };
}

/** 新建空白对话：直接访问首页最稳（工作台实战结论：createBlankChat 比点按钮稳） */
async function newChat(page) {
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);
  return page.url();
}

/** 上传产品图：ChatGPT composer 里的 file input */
async function uploadImages(page, files) {
  if (!files?.length) return;
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles(files, { timeout: 60_000 });
  // 等缩略图出现，避免图还没传完就发 prompt
  await page.waitForTimeout(1500);
  for (let i = 0; i < 60; i++) {
    const pending = await page.locator('[data-testid="composer-file-upload-progress"], .animate-pulse').count();
    if (pending === 0) break;
    await sleep(1000);
  }
}

/** 等 composer 可发送：批量/连续场景下上一轮可能仍是 stop-button 态（工作台踩过的坑） */
async function waitSendReady(page) {
  const stop = page.locator('[data-testid="stop-button"]');
  if (await stop.isVisible().catch(() => false)) {
    await stop.waitFor({ state: "hidden", timeout: 180_000 }).catch(() => {});
  }
  await page.locator('[data-testid="send-button"]').waitFor({ state: "visible", timeout: 30_000 });
}

/** 写入 prompt 并发送：真实点击聚焦 + insertText + 落字校验（Lexical composer 偶发丢焦点） */
async function sendPrompt(page, prompt) {
  await waitSendReady(page);
  const composer = page.locator("#prompt-textarea").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  for (let attempt = 0; attempt < 3; attempt++) {
    await composer.click({ timeout: 5000 }).catch(() => {});
    await page.keyboard.press("Control+a").catch(() => {});
    await page.keyboard.press("Delete").catch(() => {});
    await composer.click({ timeout: 5000 }).catch(() => {});
    await page.keyboard.insertText(prompt);
    const wrote = await page.evaluate((p) => {
      const el = document.querySelector("#prompt-textarea");
      if (!el) return false;
      const norm = (v) => (v || "").replace(/\s+/g, "");
      return norm(el.textContent || "").length >= norm(p).length * 0.95;
    }, prompt).catch(() => false);
    if (wrote) break;
    if (attempt === 2) throw new Error("composer 文本未写入，发送中止");
  }
  await page.locator('[data-testid="send-button"]').click({ timeout: 15_000 });
}

/** 消息序列（user/assistant 交替） */
async function sequence(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'))
      .map((el) => ({ role: el.getAttribute("data-message-author-role"), text: el.innerText || "" }))
  );
}

/**
 * 等待本轮回复完成。
 * 核心：用 fingerprint 在 user 消息里反向定位本轮，取其后的 assistant 文本；
 * 完成判定 = stop 按钮消失 + 文本稳定 STABLE_MS；空回且已停止则抛 CHATGPT_STOPPED_WITHOUT_OUTPUT。
 */
async function waitReply(page, fingerprint) {
  const started = Date.now();
  let stableText = "";
  let stableSince = 0;
  let stoppedSince = 0;
  while (Date.now() - started < RESPONSE_WAIT_MS) {
    const stopVisible = await page.locator('[data-testid="stop-button"]').isVisible().catch(() => false);
    const seq = await sequence(page);
    let idx = -1;
    for (let i = seq.length - 1; i >= 0; i--) {
      if (seq[i].role === "user" && seq[i].text.includes(fingerprint)) { idx = i; break; }
    }
    let text = "";
    if (idx >= 0) {
      for (let j = idx + 1; j < seq.length; j++) {
        if (seq[j].role === "assistant") { text = seq[j].text; break; }
      }
    }
    if (!text && !stopVisible) {
      stoppedSince ||= Date.now();
      if (Date.now() - stoppedSince > 15_000) {
        const e = new Error(`ChatGPT 已停止但未返回回复：${fingerprint}`);
        e.code = "CHATGPT_STOPPED_WITHOUT_OUTPUT";
        throw e;
      }
    } else if (text) {
      stoppedSince = 0;
    }
    if (text && text === stableText) {
      stableSince ||= Date.now();
      if (!stopVisible && Date.now() - stableSince >= STABLE_MS) return text;
    } else if (text) {
      stableText = text;
      stableSince = Date.now();
    }
    await sleep(POLL_MS);
  }
  throw new Error(`等待回复超时：${fingerprint}`);
}

/** 一轮：已发过就复用（幂等），否则发送并等待 */
async function step(page, prompt, fingerprint) {
  const seq = await sequence(page);
  const sent = seq.some((m) => m.role === "user" && m.text.includes(fingerprint));
  if (!sent) await sendPrompt(page, prompt);
  return waitReply(page, fingerprint);
}

async function main() {
  const args = parseArgs();
  await mkdir(args.out || ".", { recursive: true });

  const { browser, page } = await connect();
  console.log("[connect] ok");

  if (args.chatUrl) {
    await page.goto(args.chatUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  } else {
    await newChat(page);
  }

  await uploadImages(page, args.images);

  // ① 产品事实：objectiveInfo 注入（与工作台一致：与图片冲突时以图片为准）
  const objective = [
    `产品名：${args.name}`,
    args.category && `类目：${args.category}`,
    args.notes && `补充信息：${args.notes}`,
  ].filter(Boolean).join("\n");
  const factPrompt = `${FACT_PROMPT}\n\n# 用户补充客观信息\n用户已手动补充以下客观信息，请作为商品事实提取的重要参考。若补充内容与图片可见事实冲突，请以图片事实为准并标注冲突；若补充内容未在图片中展示，请纳入事实底稿并标注来源为“用户补充”。\n\n${objective}`;
  await step(page, factPrompt, FP_FACT);
  console.log("[1/3] 产品事实 ok");

  // ② SEO 关键词
  const seoTpl = await readFile(path.join(PROMPTS_DIR, "03_SEO_KEYWORDS_PROMPT.md"), "utf8");
  const seo = await step(page, seoTpl, FP_SEO);
  console.log("[2/3] SEO 词库 ok");

  // ③ Listing 文案：把 SEO 报告注入模板占位符
  const listingTpl = await readFile(path.join(PROMPTS_DIR, "04_LISTING_CONTENT_PROMPT.md"), "utf8");
  const listing = await step(page, `${FP_LISTING}\n\n${listingTpl.replace("{{SEO_KEYWORD_REPORT}}", seo)}`, FP_LISTING);
  console.log("[3/3] Listing 文案 ok");

  const out = args.out || ".";
  await writeFile(path.join(out, "03_SEO_KEYWORDS.md"), `${seo.trim()}\n`, "utf8");
  await writeFile(path.join(out, "04_LISTING_CONTENT.md"), `${listing.trim()}\n`, "utf8");
  console.log("[done] 对话地址（可 --chat-url 续跑）:", page.url());
  console.log("[done] 产物:", out);

  await browser.close();
}

main().catch((e) => {
  console.error("[fail]", e.code || "", e.message);
  process.exit(1);
});
