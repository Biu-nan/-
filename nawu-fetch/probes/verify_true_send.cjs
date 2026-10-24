// 只读核实：消息到底有没有真的发出去？
// 背景：2026-10-09 幂等守卫误判事故 —— countPromptInConversation 统计 main.innerText，
// 而 composer 位于 <main> 内，导致「刚输入的草稿」被当成「已发送的消息」→ exit=0 假成功。
//
// 判据（按优先级）：
//   1) mainCount_withoutComposer >= 1  → 已发送（剔除 composer/form/contenteditable 后仍能找到）
//   2) draftLen < 5                    → 草稿已清空（辅助）
// 旧判据 article[data-testid^="conversation-turn"] 在当前 ChatGPT DOM 已不存在（articles=0），故不使用。
//
// 只读：不点击、不输入、不清空。
const path = require('path');
const sender = require('../lib/chatgpt-sender.cjs');
const cfg = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'chatgpt-config.json'), 'utf8'));

(async () => {
  const browser = await sender.connect(cfg.cdpUrl, console);
  const ctx = browser.contexts()[0];

  // 必须锁定配置里的对话页，不能用 pages().find(/chatgpt.com/) —— 那可能命中首页
  let page = ctx.pages().find((p) => (p.url() || '').startsWith(cfg.conversationUrl));
  if (!page) {
    page = await ctx.newPage();
    await page.goto(cfg.conversationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await page.waitForTimeout(8000);

  const dateStr = new Date().toLocaleDateString('sv-SE');
  const prompt = (cfg.promptTemplate || '').replace(/\{date\}/g, dateStr);
  const key = prompt.slice(0, 40);

  const detail = await page.evaluate((k) => {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const countIn = (s) => (s ? (s.match(new RegExp(esc(k), 'g')) || []).length : 0);

    const main = document.querySelector('main');
    const root = main || document.body;

    const rawClone = root.cloneNode(true);
    const withComposer = countIn(rawClone.innerText || '');

    const clone = root.cloneNode(true);
    clone.querySelectorAll('div.ProseMirror[contenteditable="true"]').forEach((n) => n.remove());
    clone.querySelectorAll('[contenteditable="true"]').forEach((n) => n.remove());
    clone.querySelectorAll('form').forEach((n) => n.remove());
    const withoutComposer = countIn(clone.innerText || '');

    const eds = Array.from(document.querySelectorAll('div.ProseMirror[contenteditable="true"]'));
    const draftText = eds.map((e) => (e.innerText || '').trim()).join('\n');

    return {
      url: location.href,
      key: k,
      mainCount_withComposer: withComposer,
      mainCount_withoutComposer: withoutComposer,
      composerDraftLen: draftText.trim().length,
      articleCount: document.querySelectorAll('article').length,
      messageTextTail: (clone.innerText || '').trim().slice(-260)
    };
  }, key);

  detail.VERDICT = detail.mainCount_withoutComposer >= 1 ? 'SENT' : 'NOT_SENT';
  detail.NOTE = 'VERDICT 以 mainCount_withoutComposer 为准；_withComposer 会被草稿污染。article 选择器已废弃(articles=0)。';
  console.log(JSON.stringify(detail, null, 2));
  await browser.close();
})().catch((e) => {
  console.error('VERIFY_FAIL', e.message);
  process.exit(1);
});
