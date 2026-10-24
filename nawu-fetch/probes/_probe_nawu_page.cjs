// 进入补货入库模块，导出子导航 / 表头 / 按钮（找库存管理与导出）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const URL = process.argv[3] || 'https://gsp.aliexpress.com/m_apps/ascp/aechoice.purchase_order_list_aechoice';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => /csp|gsp\.aliexpress/.test(p.url())) || await ctx.newPage();

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(15000);

  const r = await page.evaluate(() => {
    const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const ths = [...new Set(Array.from(document.querySelectorAll('th, [class*=table-header] [class*=cell], [class*=thead] *'))
      .filter(vis).map(txt).filter((t) => t && t.length < 30))].slice(0, 50);
    const tabs = [...new Set(Array.from(document.querySelectorAll('[class*=tab], [role=tab], [class*=Tab]'))
      .filter(vis).map(txt).filter((t) => t && t.length < 22))].slice(0, 40);
    const btns = [...new Set(Array.from(document.querySelectorAll('button, [role=button], .next-btn, a[class*=btn]'))
      .filter(vis).map(txt).filter((t) => t && t.length < 16))].slice(0, 40);
    const menu = [...new Set(Array.from(document.querySelectorAll('li'))
      .filter(vis).map((li) => li.getAttribute('name')).filter(Boolean))].slice(0, 40);
    const linkAttrs = [...new Set(Array.from(document.querySelectorAll('[path]'))
      .map((e) => (e.getAttribute('name') || '') + ' -> ' + e.getAttribute('path')).filter(Boolean))].slice(0, 60);
    const rows = document.querySelectorAll('tbody tr, [class*=table-row], [class*=TableRow]').length;
    return {
      href: location.href, title: document.title,
      iframes: Array.from(document.querySelectorAll('iframe')).map((f) => f.src).slice(0, 6),
      headers: ths, tabs, buttons: btns, menuAttrs: menu, pathAttrs: linkAttrs, rowCount: rows,
      head: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1200),
    };
  });
  console.log(JSON.stringify(r, null, 1));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
