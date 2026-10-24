// 店小秘 仓库清单 导出侦察 v3：抓按钮真实 DOM + 点后网络请求 + 系统 Downloads 新文件 + toast
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const OUT = path.join(RAW, 'dxm_export_recon_v3.json');
const DL_DIR = 'C:/Users/User/Downloads';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/warehouse/warehouseProduct', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  // 按钮真实 DOM
  const btnHtml = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.btn')).filter((e) => (e.innerText || '').replace(/\s+/g, ' ').trim() === '仓库清单');
    return els.map((e) => ({ tag: e.tagName, cls: e.className, outer: e.outerHTML.slice(0, 300), parent: (e.parentElement || {}).outerHTML ? e.parentElement.outerHTML.slice(0, 200) : '' }));
  });

  const before = fs.existsSync(DL_DIR) ? fs.readdirSync(DL_DIR).map((f) => [f, fs.statSync(path.join(DL_DIR, f)).mtimeMs]) : [];

  const responses = [];
  page.on('response', (r) => {
    const u = r.url();
    if (/export|download|仓库|warehouse|excel|xlsx|task|async/i.test(u)) responses.push({ status: r.status(), url: u.slice(0, 160) });
  });

  // 真实点击
  let clickErr = null;
  try {
    await page.locator('.btn', { hasText: '仓库清单' }).first().click({ timeout: 8000 });
  } catch (e) { clickErr = e.message.slice(0, 90); }

  await sleep(25000);

  const after = fs.existsSync(DL_DIR) ? fs.readdirSync(DL_DIR).map((f) => [f, fs.statSync(path.join(DL_DIR, f)).mtimeMs]) : [];
  const newFiles = after.filter(([f, m]) => !before.some(([f2, m2]) => f2 === f) && /\.xlsx?$/i.test(f));

  const toast = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*=toast], [class*=message], [class*=notify], [class*=alert]'))
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10);
  });

  const result = { btnHtml, clickErr, responses: responses.slice(0, 30), newDownloads: newFiles, toast };
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
