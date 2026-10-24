// 一次性修复：把被探测脚本误清的「项目页新对话草稿」原样写回 composer（不发送）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROJECT = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/project';
const DRAFT = '优化些细节  乐临 、金亿达、广州潮诗逸箱包有限公司  是我们深度合作的代发商 他们的产品是不需要采购回来';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();
  await page.goto(PROJECT, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await sleep(10000);

  const before = await page.evaluate(() => {
    const e = Array.from(document.querySelectorAll('div.ProseMirror')).find((x) => x.getBoundingClientRect().width > 0);
    return e ? (e.innerText || '').trim() : '__NO_COMPOSER__';
  });
  if (before !== '__NO_COMPOSER__' && before.length) {
    console.log('composer 非空，放弃写入以免覆盖：' + JSON.stringify(before.slice(0, 80)));
    process.exit(0);
  }

  const r = await page.evaluate((t) => {
    const eds = Array.from(document.querySelectorAll('div.ProseMirror[contenteditable="true"]'));
    const ed = eds.find((e) => e.getBoundingClientRect().width > 0) || eds[0];
    if (!ed) return { ok: false, reason: 'no composer' };
    ed.focus();
    const sel = window.getSelection(); const range = document.createRange();
    range.selectNodeContents(ed); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
    const ok = document.execCommand('insertText', false, t);
    return { ok, len: (ed.innerText || '').trim().length };
  }, DRAFT);
  await sleep(1500);
  const after = await page.evaluate(() => {
    const e = Array.from(document.querySelectorAll('div.ProseMirror')).find((x) => x.getBoundingClientRect().width > 0);
    return e ? (e.innerText || '').trim() : '__NO_COMPOSER__';
  });
  console.log(JSON.stringify({ inserted: r, after }));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
