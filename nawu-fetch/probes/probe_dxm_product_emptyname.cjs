delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';

function parseName(c9Html) {
  // 复刻 extractProductRows 的命名逻辑，便于对照
  return null;
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/dxmCommodityProduct/index', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(10000);
  const found = [];
  for (let pNo = 1; pNo <= 18 && found.length < 6; pNo++) {
    const rows = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.vxe-body--row')).map((r) => {
        const c9 = r.querySelector('[colid="col_9"]');
        const ps = c9 ? Array.from(c9.querySelectorAll('p')).map((p) => (p.innerText || '').trim()) : [];
        const firstName = ps.find((t) => !/^\[/.test(t));
        return { sku: (c9 && c9.querySelector('a') || {}).innerText || '', name: firstName || '', ps, c9Html: c9 ? c9.innerHTML.replace(/\n/g, ' ').slice(0, 800) : null };
      });
    });
    for (const r of rows) {
      if (!r.name) { found.push(r); if (found.length >= 6) break; }
    }
    if (found.length >= 6) break;
    if (pNo < 18) {
      const next = await page.evaluate(() => {
        const b = document.querySelector('.vxe-pager--next-btn');
        if (!b || (b.classList && b.classList.contains('is--disabled'))) return 'DIS';
        b.click(); return 'OK';
      });
      if (next === 'DIS') break;
      await sleep(3500);
    }
  }
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'dxm_product_emptyname.json'), JSON.stringify(found, null, 2));
  console.log(JSON.stringify(found.slice(0, 4), null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
