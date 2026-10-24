// 逐级点击探索：补货入库 → 库存管理 → 实时库存明细 → 导出
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snap(page, tag) {
  const r = await page.evaluate(() => {
    const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
    const ths = [...new Set(Array.from(document.querySelectorAll('th, .next-table-cell, [class*=header] [class*=cell]'))
      .map(txt).filter((t) => t && t.length < 30))].slice(0, 40);
    const clickable = [...new Set(Array.from(document.querySelectorAll('a, button, li, [role=menuitem], [class*=menu-item], [class*=tab]'))
      .map(txt).filter((t) => t && t.length < 18))].slice(0, 60);
    const pag = Array.from(document.querySelectorAll('[class*=pagination], [class*=Pagination], [class*=pager]'))
      .map(txt).filter(Boolean).slice(0, 4);
    return {
      href: location.href, title: document.title, headers: ths,
      clickable, pagination: pag,
      head: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 500),
    };
  });
  console.log('\n----- ' + tag + ' -----');
  console.log('URL :', r.href.slice(0, 140));
  console.log('标题:', r.title);
  console.log('表头:', JSON.stringify(r.headers));
  console.log('可点项:', JSON.stringify(r.clickable));
  console.log('分页:', JSON.stringify(r.pagination));
  console.log('正文:', r.head);
  return r;
}

async function clickText(page, re, label) {
  const cands = [
    () => page.locator('a,button,li,span,div', { hasText: re }).filter({ hasNotText: /^\s*$/ }).first().click({ timeout: 6000 }),
    () => page.getByText(re, { exact: true }).first().click({ timeout: 6000 }),
    () => page.locator(`text=${label}`).first().click({ timeout: 6000 }),
  ];
  for (const c of cands) {
    try { await c(); return true; } catch (e) { /* next */ }
  }
  return false;
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => /csp\.aliexpress\.com/.test(p.url())) || await ctx.newPage();

  await page.goto('https://csp.aliexpress.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);
  await snap(page, '舞台0：CSP 首页');

  console.log('\n>>> 点击【补货入库】');
  console.log('结果:', await clickText(page, /补货入库/, '补货入库'));
  await sleep(10000);
  await snap(page, '舞台1：补货入库');

  console.log('\n>>> 点击【库存管理】');
  console.log('结果:', await clickText(page, /库存管理/, '库存管理'));
  await sleep(10000);
  await snap(page, '舞台2：库存管理');

  console.log('\n>>> 点击【实时库存明细】/【库存明细】');
  console.log('结果:', await clickText(page, /实时库存明细|库存明细|实时库存/, '实时库存明细'));
  await sleep(12000);
  await snap(page, '舞台3：实时库存明细');

  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
