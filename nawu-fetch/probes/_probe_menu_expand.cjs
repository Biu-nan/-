// 1) 在 CSP 壳里展开「补货入库」子菜单，抓子项 path；2) 探 dchain 独立门户菜单
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pathsOf = (page) =>
  page.evaluate(() => {
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    return [...new Set(Array.from(document.querySelectorAll('[path]'))
      .filter(vis)
      .map((e) => (e.getAttribute('name') || (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 18)) + ' => ' + e.getAttribute('path')))];
  });

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  console.log('=== A. CSP 壳内展开补货入库 ===');
  await page.goto('https://csp.aliexpress.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);
  console.log('展开前 path 项:', JSON.stringify(await pathsOf(page)));

  for (const sel of ['#Root-Home-stockandinbound [role=menuitem]', '#Root-Home-stockandinbound']) {
    try {
      await page.locator(sel).first().click({ timeout: 6000 });
      console.log('已点击: ' + sel);
      await sleep(4000);
      break;
    } catch (e) { console.log('点击失败 ' + sel + ': ' + e.message.slice(0, 60)); }
  }
  console.log('展开后 path 项:');
  (await pathsOf(page)).forEach((p) => console.log('   ' + p));

  console.log('\n=== B. dchain 独立门户 ===');
  try {
    await page.goto('https://dchain-web.aliexpress.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(12000);
    const r = await page.evaluate(() => {
      const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
      const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      return {
        href: location.href, title: document.title,
        shorts: [...new Set(Array.from(document.querySelectorAll('div,span,li,a,button')).filter(vis)
          .map(txt).filter((t) => t && t.length <= 10 && !/^[\d,.\s]+$/.test(t)))].slice(0, 100),
        hrefs: [...new Set(Array.from(document.querySelectorAll('a[href]')).filter(vis)
          .map((a) => txt(a) + ' :: ' + a.getAttribute('href')))].slice(0, 40),
      };
    });
    console.log('URL :', r.href.slice(0, 130));
    console.log('标题:', r.title);
    console.log('短文本:', r.shorts.join(' | '));
    console.log('链接:');
    r.hrefs.forEach((h) => console.log('   ' + h.slice(0, 130)));
  } catch (e) { console.log('dchain 门户失败: ' + e.message.slice(0, 90)); }

  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
