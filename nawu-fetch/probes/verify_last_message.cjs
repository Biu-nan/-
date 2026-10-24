// 只读探针：确认 ChatGPT 对话最后一条消息是否为本次发送的提示词（不写入、不清 composer）
// 用法：node probes/verify_last_message.cjs
const { chromium } = require('playwright-core');
const path = require('path');

const CFG = path.join(__dirname, '..', 'chatgpt-config.json');
const cfg = JSON.parse(require('fs').readFileSync(CFG, 'utf8'));

(async () => {
  const browser = await chromium.connectOverCDP(cfg.cdpUrl);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) {
    page = await ctx.newPage();
    await page.goto(cfg.conversationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await page.waitForTimeout(8000);
  const probeDate = process.env.PROBE_DATE || new Date().toLocaleDateString('sv-SE');
  const phrase = '今天是 ' + probeDate;
  const info = await page.evaluate((phrase) => {
    const arts = Array.from(
      document.querySelectorAll('[data-message-author-role]')
    );
    // 本次提示词特征串：直接在整个对话文本里找，确认是否已发送
    const bodyText = document.body.innerText || '';
    // phrase 由 Node 侧传入（浏览器上下文无 process，不能在 evaluate 内生成日期）
    const found = bodyText.includes(phrase);
    const hitIdx = bodyText.indexOf(phrase);
    // 取最后一个较完整（文本长度>80）的消息容器，作为「最后一条消息」
    const big = arts.filter((e) => ((e.innerText || '').length > 80));
    const last = big[big.length - 1] || null;
    return {
      url: location.href,
      title: document.title,
      msgCount: arts.length,
      promptsFoundInBody: found,
      lastPromptSnippet: hitIdx >= 0 ? bodyText.slice(hitIdx, hitIdx + 160).replace(/\s+/g, ' ') : null,
      lastText: last ? (last.innerText || '').replace(/\s+/g, ' ').slice(0, 200) : null,
    };
  }, phrase);
  console.log(JSON.stringify({ probeDate, ...info }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error('PROBE_FAIL', e.message);
  process.exit(1);
});
