// 店小秘 商品管理 + 出入记录 侦察：表头 / 行结构 / 分页 / 出入记录 URL
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const OUT = path.join(RAW, 'dxm_pages_recon.json');

async function dumpTable(page, label) {
  await sleep(12000);
  return page.evaluate(() => {
    const table = Array.from(document.querySelectorAll('table')).find((t) => t.querySelector('thead') && t.innerText.length > 50);
    const ths = table ? Array.from(table.querySelectorAll('thead th')).map((th) => (th.innerText || '').replace(/\s+/g, ' ').trim()) : [];
    let rows = [];
    const tbody = table ? table.querySelector('tbody') : null;
    if (tbody) rows = Array.from(tbody.querySelectorAll('tr')).slice(0, 1);
    const rowTexts = rows.map((tr) => Array.from(tr.children).map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 20));
    const rowHtml = rows[0] ? rows[0].outerHTML.slice(0, 1800) : null;
    const pgMatch = (document.body.innerText || '').match(/共\s*([\d,]+)\s*条记录/);
    const total = pgMatch ? pgMatch[1] : null;
    return { ths, rowCount: tbody ? tbody.querySelectorAll('tr').length : 0, rowTexts, rowHtml, total };
  });
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();

  // 1) 商品管理
  await page.goto('https://www.dianxiaomi.com/web/dxmCommodityProduct/index', { waitUntil: 'domcontentloaded', timeout: 90000 });
  const product = await dumpTable(page, 'product');

  // 2) 找 出入记录 URL（左侧仓库子菜单）
  const navLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="warehouse"], a[href*="stock"]'));
    const rel = links.map((a) => ({ t: (a.innerText || '').replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') }))
      .filter((x) => x.t && /仓|出入|库存|调拨|盘点|批次/i.test(x.t));
    return rel;
  });

  const result = { product, navLinks };
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
