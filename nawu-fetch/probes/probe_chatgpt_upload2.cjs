// 上传诊断 2：setInputFiles 后 input.files 是否真的拿到文件；+ 菜单结构
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
  await input.setInputFiles(file, { timeout: 60000 });
  await sleep(6000);
  const after = await page.evaluate(() => {
    const inp = document.querySelector('form input[type=file]:not([accept])');
    return {
      filesLen: inp && inp.files ? inp.files.length : -1,
      fileName: inp && inp.files && inp.files[0] ? inp.files[0].name : '',
      bodyHasFile: /nawu-1店-inventory/.test(document.body.innerText || ''),
    };
  });
  console.log('setInputFiles 后:', JSON.stringify(after));

  // 刷新清空，试 + 菜单
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(4000);
  const plus = page.locator('button[aria-label="添加文件等内容"]').first();
  console.log('+ 按钮存在:', await plus.count());
  await plus.click().catch((e) => console.log('click + 失败', e.message));
  await sleep(1500);
  const menu = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] *, [data-radix-collection-item]'))
      .map((e) => ({ role: e.getAttribute('role') || '', t: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30), testid: e.getAttribute('data-testid') || '' }))
      .filter((x) => x.t).slice(0, 20);
    return { items };
  });
  console.log('+ 菜单:', JSON.stringify(menu, null, 2));
  await page.keyboard.press('Escape').catch(() => {});
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
