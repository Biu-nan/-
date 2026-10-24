// 采购订单 行单元格结构侦察（只读）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_po_rows_recon.json';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  const res = { at: new Date().toISOString(), pages: [] };
  for (const [name, url] of [
    ['待到货', 'https://www.dianxiaomi.com/web/purchasing/order/waitArrival'],
    ['已完成', 'https://www.dianxiaomi.com/web/purchasing/order/complete'],
  ]) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(11000);
    const d = await page.evaluate((nm) => {
      const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
      const headers = Array.from(document.querySelectorAll('.vxe-header--column')).map((c) => ({ colid: c.getAttribute('colid'), t: txt(c).slice(0, 18) }));
      const rowEls = Array.from(document.querySelectorAll('.vxe-body--row')).slice(0, 3);
      const rows = rowEls.map((row) => Array.from(row.children).map((c) => ({ colid: c.getAttribute('colid'), span: c.getAttribute('rowspan') || '', t: txt(c).slice(0, 100) })));
      return { name: nm, url: location.href, rowCount: document.querySelectorAll('.vxe-body--row').length, headers, rows };
    }, name);
    res.pages.push(d);
    console.log(`== ${name} rows=${d.rowCount}`);
    console.log('  HDR: ' + JSON.stringify(d.headers));
    d.rows.forEach((r, i) => console.log(`  R${i}: ` + JSON.stringify(r)));
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  console.log('written ' + OUT);
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
