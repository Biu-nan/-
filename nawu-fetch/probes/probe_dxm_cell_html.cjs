// 店小秘 vxe-table 单元格侦察：dump 首行 商品信息/库存情况 单元格 HTML + 全部单元格文本
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const OUT = path.join(RAW, 'dxm_cell_html.json');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/warehouse/warehouseProduct', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const data = await page.evaluate(() => {
    function rowsFrom(sel) { return Array.from(document.querySelectorAll(sel)); }
    let rows = rowsFrom('.vxe-body--row');
    if (!rows.length) rows = rowsFrom('.vxe-table--body tbody tr');
    if (!rows.length) rows = rowsFrom('tbody tr');
    const row = rows[0];
    if (!row) return { error: 'no body row', tried: ['.vxe-body--row', '.vxe-table--body tbody tr', 'tbody tr'] };
    const cells = Array.from(row.children).map((c) => Array.from(c.querySelectorAll('.vxe-cell, [class*=cell]')).length ? c.querySelector('.vxe-cell, [class*=cell]') : c);
    const cellTexts = Array.from(row.children).map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim());
    // 商品信息 + 库存情况 单元格 HTML（首行）
    const cellHtml = Array.from(row.children).map((c) => (c.outerHTML || '').slice(0, 600));
    return { rowSelector: '.vxe-body--row', rowCount: rows.length, cellCount: cellTexts.length, cellTexts, cellHtml };
  });
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
