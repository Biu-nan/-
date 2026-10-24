// 侦察 v3：滚到对话底部，检测 composer 的「功能状态」（是否可编辑/是否禁用/有无发送键/有无上限横幅）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONV = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/c/6aaac0ca-1bf4-83ec-aefd-d514390c9539';

const scan = () => {
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const pros = qa('div.ProseMirror, [contenteditable]').map((e) => {
    const r = e.getBoundingClientRect();
    return {
      tag: e.tagName,
      cls: (e.className || '').toString().slice(0, 70),
      ce: e.getAttribute('contenteditable'),
      aria: e.getAttribute('aria-label') || '',
      ariaDisabled: e.getAttribute('aria-disabled') || '',
      dataDisabled: e.getAttribute('data-disabled') || '',
      w: Math.round(r.width), h: Math.round(r.height),
      txt: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 80),
    };
  });
  const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ');
  return {
    url: location.href,
    hasLimitText: /长度上限|length limit/i.test(bodyText),
    bodyTail: bodyText.slice(-300),
    proseMirrors: pros.filter((p) => /ProseMirror/.test(p.cls) || p.ce !== null).slice(0, 12),
    sendBtns: qa('#composer-submit-button, button[data-testid="send-button"], button[aria-label="发送"], button[aria-label="Send"]').map((b) => {
      const r = b.getBoundingClientRect();
      return { aria: b.getAttribute('aria-label') || '', testid: b.getAttribute('data-testid') || '', disabled: !!b.disabled, w: Math.round(r.width), h: Math.round(r.height) };
    }),
    forms: qa('form').map((f) => ({ testid: f.getAttribute('data-testid') || '', hasProse: !!f.querySelector('div.ProseMirror'), txt: (f.innerText || '').replace(/\s+/g, ' ').slice(0, 120) })),
    scrollBottomBtn: qa('button').map((b) => (b.getAttribute('aria-label') || '') + '|' + (b.innerText || '').replace(/\s+/g, ' ').trim()).filter((s) => /最新|latest|底部|bottom|scroll/i.test(s)).slice(0, 6),
  };
};

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();
  await page.goto(CONV, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await sleep(15000);

  // 滚到底：点「跳到最新一条回复」按钮，否则对滚动容器直接 scrollTop=scrollHeight
  const out = { steps: [] };
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const jump = btns.find((b) => /最新一条回复|latest/i.test((b.getAttribute('aria-label') || '') + (b.innerText || '')));
      if (jump) jump.click();
      // 找最深的可滚动容器并置底
      const scrollables = Array.from(document.querySelectorAll('div')).filter((d) => d.scrollHeight > d.clientHeight + 50 && d.clientHeight > 200);
      scrollables.forEach((d) => { d.scrollTop = d.scrollHeight; });
      window.scrollTo(0, document.body.scrollHeight);
    }).catch(() => {});
    await sleep(6000);
    const s = await page.evaluate(scan);
    out.steps.push({ round: i + 1, ...s });
    if (s.hasLimitText) break;
  }
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'chatgpt_limit_recon3.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
