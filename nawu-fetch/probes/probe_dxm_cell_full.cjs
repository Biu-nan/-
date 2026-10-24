// 店小秘 商品信息单元格完整 HTML 侦察（找 SKU/编码/名称 结构化元素）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const OUT = path.join(RAW, 'dxm_cell_full.json');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/warehouse/warehouseProduct', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const data = await page.evaluate(() => {
    const row = document.querySelector('.vxe-body--row');
    const cell = row.children[1];
    // 商品信息里所有带文本的子元素（含 class 提示）
    const spans = Array.from(cell.querySelectorAll('*')).map((e) => ({ cls: (e.className||'').toString().slice(0,40), t: (e.innerText||'').replace(/\s+/g,' ').trim().slice(0,60) })).filter((x)=>x.t);
    return { fullHtml: cell.outerHTML.slice(0, 2500), spans: spans.slice(0, 40) };
  });
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
