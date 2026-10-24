// 精确定位 composer 内的：文件上传 input / + 按钮 / 发送按钮（不发送，只侦察）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/c/6aaac0ca-1bf4-83ec-aefd-d514390c9539';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await sleep(22000);

  const dump = await page.evaluate(() => {
    const ed = document.querySelector('div.ProseMirror[contenteditable="true"]');
    if (!ed) return { err: 'no composer' };
    let form = ed.closest('form');
    // 若不在 form 内，向上找带 file input 的祖先
    let scope = form;
    if (!scope) {
      let p = ed;
      for (let i = 0; i < 8 && p; i++) { if (p.querySelector && p.querySelector('input[type=file]')) { scope = p; break; } p = p.parentElement; }
    }
    const within = (el, s) => (el ? Array.from(el.querySelectorAll(s)) : []);
    const fileInputs = within(scope, 'input[type=file]').map((i, idx) => ({ idx, accept: i.getAttribute('accept'), multiple: i.multiple, testid: i.getAttribute('data-testid') || '', name: i.getAttribute('name') || '' }));
    const buttons = within(scope, 'button').map((b) => ({ testid: b.getAttribute('data-testid') || '', aria: b.getAttribute('aria-label') || '', txt: (b.innerText || '').trim().slice(0, 20), disabled: b.disabled })).slice(0, 12);
    return {
      composerTag: ed.tagName, composerAria: ed.getAttribute('aria-label'),
      inForm: !!form, formClass: form ? (form.className || '').toString().slice(0, 80) : '',
      scopeTag: scope ? scope.tagName : null, scopeClass: scope ? (scope.className || '').toString().slice(0, 80) : '',
      fileInputCount: fileInputs.length, fileInputs, buttons,
    };
  });
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'chatgpt_composer_recon.json'), JSON.stringify(dump, null, 2));
  console.log(JSON.stringify(dump, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
