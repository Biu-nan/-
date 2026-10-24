delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/dxmCommodityProduct/index', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);
  const samples = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.vxe-body--row')).slice(0, 40);
    return rows.map((r) => {
      const c9 = r.querySelector('[colid="col_9"]');
      return {
        col9Html: c9 ? c9.innerHTML.replace(/\n/g, ' ').slice(0, 700) : null,
        ps: c9 ? Array.from(c9.querySelectorAll('p')).map((p) => (p.innerText || '').trim()) : [],
        links: c9 ? Array.from(c9.querySelectorAll('a')).map((a) => (a.innerText || '').trim()) : [],
      };
    });
  });
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'dxm_product_col9.json'), JSON.stringify(samples, null, 2));
  console.log(JSON.stringify(samples.slice(0, 6), null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
