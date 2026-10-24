// 打开「库存管理」(inventory_distribution_details_management)，导出表头/筛选项/导出按钮/行数
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  const url = 'https://dchain-web.aliexpress.com/pages/aechoice/inventory_distribution_details_management?channelId=2443536';
  console.log('打开:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(20000);

  const r = await page.evaluate(() => {
    const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const ths = [...new Set(Array.from(document.querySelectorAll('th')).filter(vis).map(txt).filter(Boolean))];
    const btns = [...new Set(Array.from(document.querySelectorAll('button,[role=button],a[class*=btn]'))
      .filter(vis).map(txt).filter((t) => t && t.length < 16))];
    const labels = [...new Set(Array.from(document.querySelectorAll('label,[class*=label],[class*=form-item]'))
      .filter(vis).map(txt).filter((t) => t && t.length < 26))].slice(0, 50);
    const tabs = [...new Set(Array.from(document.querySelectorAll('[role=tab],[class*=tab-item],[class*=Tab]'))
      .filter(vis).map(txt).filter((t) => t && t.length < 20))];
    const rows = document.querySelectorAll('tbody tr').length;
    const firstRow = (() => {
      const tr = document.querySelector('tbody tr');
      return tr ? Array.from(tr.querySelectorAll('td')).map(txt) : null;
    })();
    return {
      href: location.href, title: document.title,
      headers: ths, buttons: btns, tabs, filterLabels: labels, rowCount: rows, firstRow,
      head: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1400),
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
