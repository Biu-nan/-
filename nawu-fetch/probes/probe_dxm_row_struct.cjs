// 店小秘 仓库清单 行结构侦察：定位数据表，dump 前 2 行 td 结构与 库存情况 子值
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const OUT = path.join(RAW, 'dxm_row_struct.json');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/warehouse/warehouseProduct', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const data = await page.evaluate(() => {
    const table = Array.from(document.querySelectorAll('table')).find((t) => /商品信息/.test(t.innerText) && /仓库位置/.test(t.innerText));
    if (!table) return { error: 'data table not found' };
    const rows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 2);
    return {
      tableFound: true,
      thCount: table.querySelectorAll('thead th').length,
      rowCount: rows.length,
      rows: rows.map((tr) => {
        const tds = Array.from(tr.querySelectorAll('td'));
        return tds.map((td) => {
          const nested = Array.from(td.querySelectorAll('table td, [class*=sub] td, td'));
          return {
            text: (td.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 140),
            tdCount: td.querySelectorAll(':scope > table td, :scope > div[class*=cell] > *, :scope > span').length,
            allNums: (td.innerText || '').match(/\d+/g),
          };
        });
      }),
    };
  });
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
