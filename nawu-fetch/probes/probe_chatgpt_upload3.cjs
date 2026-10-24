// 上传诊断 3：上传 1 文件后，定位「附件 chip」的结构与选择器
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
  await form.locator('input[type=file]:not([accept])').first().setInputFiles(file, { timeout: 60000 });

  let found = null;
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    found = await page.evaluate(() => {
      const name = 'nawu-1店-inventory-latest.xlsx';
      const hits = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').includes('nawu-1店'));
      if (!hits.length) return null;
      const chip = hits[0];
      const chain = [];
      let p = chip;
      for (let k = 0; k < 5 && p; k++) { chain.push({ tag: p.tagName, cls: (p.className || '').toString().slice(0, 70), testid: p.getAttribute('data-testid') || '', role: p.getAttribute('role') || '' }); p = p.parentElement; }
      // 统计同层附件数量
      const list = chip.closest('[data-testid], [class*="attachment" i], [class*="file" i]');
      return { text: (chip.innerText || '').trim(), chain, listTestid: list ? list.getAttribute('data-testid') : null, listCls: list ? (list.className || '').toString().slice(0, 60) : null };
    });
    if (found) break;
  }
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'chatgpt_upload3.json'), JSON.stringify(found, null, 2));
  console.log(JSON.stringify(found, null, 2));

  // 统计页面上所有含 .xlsx 的叶子节点（多文件时数量应等于附件数）
  const count = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /\.xlsx/.test(e.innerText || '')).length);
  console.log('页面上含 .xlsx 的叶子节点数 =', count);

  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(2500);
  console.log('已刷新清空');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
