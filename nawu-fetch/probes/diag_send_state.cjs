// 只读诊断：判定本次提示词究竟「已发送」还是「仍在 composer 草稿里」
// 不点击、不输入、不清空。用法：node probes/diag_send_state.cjs
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
  await page.waitForTimeout(6000);
  const probeDate = process.env.PROBE_DATE || new Date().toLocaleDateString('sv-SE');
  const phrase = '今天是 ' + probeDate;

  const info = await page.evaluate((phrase) => {
    const body = document.body.innerText || '';
    const hits = [];
    let i = body.indexOf(phrase);
    while (i >= 0) {
      hits.push({ idx: i, ratio: +(i / body.length).toFixed(3), ctx: body.slice(Math.max(0, i - 60), i + 140).replace(/\s+/g, ' ') });
      i = body.indexOf(phrase, i + 1);
    }
    // 消息容器：Chrome 153 无 data-message-author-role，退化为按 <main>/form 之外的结构判断
    const forms = Array.from(document.querySelectorAll('form[data-chatgpt-composer]')).map((f) => ({
      composerText: (f.innerText || '').slice(0, 120),
    }));
    const editors = Array.from(document.querySelectorAll('div.ProseMirror[contenteditable="true"]')).map((e) => {
      const r = e.getBoundingClientRect();
      return { textLen: (e.innerText || '').length, visible: r.width > 0 && r.height > 0, cls: e.className || '' };
    });
    const btns = Array.from(document.querySelectorAll('button')).filter((b) => {
      const la = (b.getAttribute('aria-label') || '') + (b.id || '');
      return /发送|Send|submit/i.test(la);
    }).map((b) => {
      const r = b.getBoundingClientRect();
      return {
        aria: b.getAttribute('aria-label'), id: b.id, testid: b.getAttribute('data-testid'),
        disabled: b.disabled, cls: (b.className || '').slice(0, 80),
        visible: r.width > 0 && r.height > 0, w: Math.round(r.width), h: Math.round(r.height),
      };
    });
    return {
      url: location.href,
      bodyLen: body.length,
      phraseHits: hits.length,
      hits,
      editorCount: editors.length,
      editors,
      formCount: forms.length,
      formSample: forms.slice(0, 1),
      sendButtons: btns,
      // 是否有「正在思考」类中间态
      thinking: /正在思考|Thinking|正在输入|正在检索/i.test(body),
    };
  }, phrase);

  console.log(JSON.stringify({ probeDate, ...info }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error('DIAG_FAIL', e.message);
  process.exit(1);
});
