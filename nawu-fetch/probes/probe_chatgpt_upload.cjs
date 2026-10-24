// 上传验证（不发送）：上传 1 个 xlsx，观察附件 DOM，然后刷新页面清空
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const D = 'F:/yikuaborder-deploy/纳物采购最新数据/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/c/6aaac0ca-1bf4-83ec-aefd-d514390c9539';

(async () => {
  const file = path.join(D, 'nawu-1店-inventory-latest.xlsx');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await page.waitForSelector('div.ProseMirror[contenteditable="true"]', { timeout: 60000 });
  await sleep(4000);

  const form = page.locator('form').filter({ has: page.locator('div.ProseMirror[contenteditable="true"]') }).first();
  const input = form.locator('input[type=file]:not([accept])').first();
  const cnt = await input.count();
  console.log('generic file input count =', cnt);
  await input.setInputFiles(file, { timeout: 60000 });
  console.log('setInputFiles done, waiting 10s...');
  await sleep(10000);

  const dump = await page.evaluate(() => {
    const form = document.querySelector('form');
    const txt = (form ? form.innerText : '').replace(/\s+/g, ' ');
    // 找疑似附件元素
    const att = Array.from(document.querySelectorAll('[data-testid*="attachment" i], [class*="attachment" i], [class*="file" i]'))
      .map((e) => ({ tag: e.tagName, testid: e.getAttribute('data-testid') || '', cls: (e.className || '').toString().slice(0, 50), t: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 50) }))
      .filter((x) => x.t || x.testid).slice(0, 12);
    const send = document.querySelector('#composer-submit-button, button[data-testid="send-button"]');
    return { formText: txt.slice(0, 300), att, sendBtn: send ? { testid: send.getAttribute('data-testid'), aria: send.getAttribute('aria-label'), disabled: send.disabled } : null };
  });
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'chatgpt_upload_recon.json'), JSON.stringify(dump, null, 2));
  console.log(JSON.stringify(dump, null, 2));

  // 清理：刷新页面丢弃未发送的附件
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(3000);
  console.log('已刷新页面清理未发送附件');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
