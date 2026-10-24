// 只读验证：用修复后的 countPromptInConversation 判定当前对话里是否已有本次提示词
// 不点击、不输入、不清空。用法：node probes/verify_send_verifier.cjs
const { chromium } = require('playwright-core');
const path = require('path');
const sender = require('../lib/chatgpt-sender.cjs');
const cfgPath = path.join(__dirname, '..', 'chatgpt-config.json');
const cfg = JSON.parse(require('fs').readFileSync(cfgPath, 'utf8'));

(async () => {
  const browser = await sender.connect(cfg.cdpUrl, console);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) {
    page = await ctx.newPage();
    await page.goto(cfg.conversationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await page.waitForTimeout(6000);
  const dateStr = new Date().toLocaleDateString('sv-SE');
  const prompt = (cfg.promptTemplate || '').replace(/\{date\}/g, dateStr);
  const v = await sender.countPromptInConversation(page, prompt);
  console.log(JSON.stringify({ dateStr, promptLen: prompt.length, verdict: v, ok: v.sentMessages >= 1 }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error('VERIFY_FAIL', e.message);
  process.exit(1);
});
