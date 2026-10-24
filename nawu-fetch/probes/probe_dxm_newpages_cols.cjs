// 店小秘 新增页 colid / 行结构侦察（只读）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_newpages_cols.json';

async function dumpCols(page, label) {
  await sleep(9000);
  return page.evaluate((lb) => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    const headers = Array.from(document.querySelectorAll('.vxe-header--column')).map((c) => ({
      colid: c.getAttribute('colid'), w: c.getAttribute('colwidth') || '', t: txt(c).slice(0, 20),
    }));
    const rows = Array.from(document.querySelectorAll('.vxe-body--row')).slice(0, 4).map((row) =>
      Array.from(row.children).map((cell) => ({
        colid: cell.getAttribute('colid'), span: cell.getAttribute('rowspan') || '',
        t: txt(cell).slice(0, 90),
      }))
    );
    return { label: lb, url: location.href, headers, sampleRows: rows };
  }, label);
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  const res = { at: new Date().toISOString(), pages: [] };
  const targets = [
    ['采购订单-全部', 'https://www.dianxiaomi.com/web/purchasing/order/draft/manualPurchasing'],
    ['供货商', 'https://www.dianxiaomi.com/web/supply/supplier'],
    ['供货关系', 'https://www.dianxiaomi.com/web/supply/supplyRelation'],
    ['出入记录', 'https://www.dianxiaomi.com/web/privateWarehouse/entryAndExitRecordList'],
    ['仓库清单', 'https://www.dianxiaomi.com/web/warehouse/warehouseProduct'],
  ];
  for (const [label, url] of targets) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const d = await dumpCols(page, label);
      res.pages.push(d);
      console.log(`== ${label}`);
      console.log('  HDR: ' + JSON.stringify(d.headers));
      d.sampleRows.forEach((r, i) => console.log(`  R${i}: ` + JSON.stringify(r)));
    } catch (e) {
      res.pages.push({ label, url, error: e.message.slice(0, 160) });
      console.log(`== ${label} ERR ${e.message.slice(0, 100)}`);
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  console.log('written ' + OUT);
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
