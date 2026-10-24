// 只读结构探针：定位提示词所在节点形态 + 判断是否已生成回复（不写入）
// 用法：node probes/diag_dom_structure.cjs
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
    const all = Array.from(document.querySelectorAll('*'));
    const phraseNodes = [];
    for (const el of all) {
      if (el.children.length > 3) continue; // 只看叶子/浅节点
      const t = (el.innerText || '').includes(phrase);
      if (!t) continue;
      phraseNodes.push({
        tag: el.tagName,
        cls: (el.className && String(el.className).slice(0, 60)) || '',
        inForm: !!el.closest('form'),
        inMain: !!el.closest('main'),
        textLen: (el.innerText || '').length,
      });
    }
    const body = document.body.innerText || '';
    const stopBtns = Array.from(document.querySelectorAll('button')).map((b) => (b.getAttribute('aria-label') || '') + '|' + (b.id || '')).filter((s) => /停止|Stop|stop/i.test(s));
    const main = document.querySelector('main');
    const mainText = main ? (main.innerText || '') : '';
    return {
      url: location.href,
      phraseNodeCount: phraseNodes.length,
      phraseNodes: phraseNodes.slice(0, 6),
      bodyLen: body.length,
      bodyTail: body.replace(/\s+/g, ' ').slice(-400),
      stopButtons: stopBtns,
      mainLen: mainText.length,
      mainTail: mainText.replace(/\s+/g, ' ').slice(-300),
      bodyHasPhrase: body.includes(phrase),
      mainHasPhrase: mainText.includes(phrase),
      // 附件 chip 计数（出现在 form 内的附件名）
      chipNames: Array.from(document.querySelectorAll('[data-testid="attachment-name"], .attachment-chip, [class*="attachment"]'))
        .map((e) => (e.getAttribute('data-testid') || e.className || '').toString().slice(0, 40))
        .filter(Boolean)
        .slice(0, 8),
    };
  }, phrase);

  console.log(JSON.stringify({ probeDate, ...info }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error('DIAG2_FAIL', e.message);
  process.exit(1);
});
