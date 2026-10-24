// 探索：进入「补货入库」→ 找「库存管理 / 实时库存明细」→ 找导出按钮
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => /csp\.aliexpress\.com/.test(p.url())) || await ctx.newPage();

  console.log('=== 1. 回到 CSP 首页，收集全部导航链接 ===');
  await page.goto('https://csp.aliexpress.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const all = await page.evaluate(() =>
    [...new Set(Array.from(document.querySelectorAll('a[href]'))
      .map((a) => ((a.innerText || '').replace(/\s+/g, ' ').trim()) + ' :: ' + a.getAttribute('href'))
      .filter((t) => t.length > 6))].slice(0, 120));
  console.log('全部链接:');
  all.forEach((l) => console.log('  ' + l.slice(0, 160)));

  console.log('\n=== 2. 进入「补货入库」 ===');
  let target = null;
  for (const l of all) {
    if (/补货入库/.test(l) && /::/.test(l)) { target = l.split(' :: ')[1]; break; }
  }
  console.log('补货入库 URL =', target);
  if (!target) { console.log('未找到链接，尝试直接点击'); }
  else {
    if (target.startsWith('/')) target = 'https://csp.aliexpress.com' + target;
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(12000);
    const r = await page.evaluate(() => ({
      href: location.href, title: document.title,
      sideMenu: [...new Set(Array.from(document.querySelectorAll('nav a, aside a, [class*=menu] a, [class*=Menu] a, [class*=side] a, li a'))
        .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 24))].slice(0, 60),
      stockLinks: [...new Set(Array.from(document.querySelectorAll('a[href]'))
        .map((a) => ((a.innerText || '').replace(/\s+/g, ' ').trim()) + ' :: ' + a.getAttribute('href'))
        .filter((t) => /库存|实时|明细|仓/i.test(t)))].slice(0, 30),
      buttons: [...new Set(Array.from(document.querySelectorAll('button, [role=button], .next-btn, a'))
        .map((e) => (e.innerText || '').trim()).filter((t) => t && t.length < 16))].slice(0, 40),
      head: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
    }));
    console.log(JSON.stringify(r, null, 1));
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
