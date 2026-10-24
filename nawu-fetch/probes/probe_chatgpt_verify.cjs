// 验证：对话里最新一条用户消息是否带附件、助手是否在回复
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/c/6aaac0ca-1bf4-83ec-aefd-d514390c9539';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await sleep(20000);

  const r = await page.evaluate(() => {
    const turns = Array.from(document.querySelectorAll('article[data-testid*="conversation-turn"], [data-message-author-role]'));
    const role = (e) => e.getAttribute('data-message-author-role') || (e.querySelector('[data-message-author-role]') ? e.querySelector('[data-message-author-role]').getAttribute('data-message-author-role') : '');
    const last = turns.slice(-3).map((e) => ({ role: role(e), t: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 200) }));
    // 找最后一条含 .xlsx 的用户消息
    const bodyTxt = document.body.innerText || '';
    const xlsxMentions = (bodyTxt.match(/[^\s]*\.xlsx/g) || []).slice(-8);
    const hasTodayPrompt = /今天是 2026-09-29/.test(bodyTxt);
    const stopBtn = !!document.querySelector('button[data-testid="stop-button"], button[aria-label*="停止"]');
    return { turnCount: turns.length, last, xlsxMentions, hasTodayPrompt, stopBtn };
  });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
