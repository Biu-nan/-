// 侦察 v4：往 composer 输入测试文本，判定发送键是否可用（直接测「还能不能发消息」），随后清空
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONV = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/c/6aaac0ca-1bf4-83ec-aefd-d514390c9539';
const PROJECT = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/project';

const SEND_SEL = '#composer-submit-button, button[data-testid="send-button"], button[aria-label="发送"], button[aria-label="Send"]';
const typeSentinel = () => {
  const eds = Array.from(document.querySelectorAll('div.ProseMirror[contenteditable="true"]'));
  const ed = eds.find((e) => e.getBoundingClientRect().width > 0) || eds[0];
  if (!ed) return { ok: false, reason: 'no composer' };
  ed.focus();
  const sel = window.getSelection(); const r = document.createRange();
  r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
  const ok = document.execCommand('insertText', false, 'PROBE-TEST-123');
  return { ok, len: (ed.innerText || '').length };
};
const clearComposer = () => {
  const eds = Array.from(document.querySelectorAll('div.ProseMirror[contenteditable="true"]'));
  const ed = eds.find((e) => e.getBoundingClientRect().width > 0) || eds[0];
  if (!ed) return 'no composer';
  ed.focus();
  const sel = window.getSelection(); const r = document.createRange();
  r.selectNodeContents(ed); sel.removeAllRanges(); sel.addRange(r);
  document.execCommand('delete');
  return (ed.innerText || '').trim().slice(0, 60);
};
const dump = () => {
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ');
  return {
    url: location.href,
    hasLimitText: /长度上限|length limit/i.test(bodyText),
    tail: bodyText.slice(-260),
    composerText: qa('div.ProseMirror').map((e) => (e.innerText || '').trim().slice(0, 60)),
    send: qa('#composer-submit-button, button[data-testid="send-button"], button[aria-label="发送"], button[aria-label="Send"]').map((b) => {
      const r = b.getBoundingClientRect();
      return { aria: b.getAttribute('aria-label') || '', testid: b.getAttribute('data-testid') || '', id: b.id || '', disabled: !!b.disabled, ariaDisabled: b.getAttribute('aria-disabled') || '', w: Math.round(r.width), h: Math.round(r.height) };
    }),
    otherComposerBtns: qa('form button').map((b) => (b.getAttribute('aria-label') || b.getAttribute('data-testid') || '').slice(0, 30)).filter(Boolean).slice(0, 12),
  };
};

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();
  const out = {};

  // A. 现有（可能已满）的对话
  await page.goto(CONV, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await sleep(18000);
  out.convBeforeType = await page.evaluate(dump);
  out.convType = await page.evaluate(typeSentinel);
  await sleep(4000);
  out.convAfterType = await page.evaluate(dump);
  out.convCleared = await page.evaluate(clearComposer);

  // B. 项目页的新对话
  await page.goto(PROJECT, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);
  out.projBeforeType = await page.evaluate(dump);
  out.projType = await page.evaluate(typeSentinel);
  await sleep(4000);
  out.projAfterType = await page.evaluate(dump);
  out.projCleared = await page.evaluate(clearComposer);

  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'chatgpt_limit_recon4.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
