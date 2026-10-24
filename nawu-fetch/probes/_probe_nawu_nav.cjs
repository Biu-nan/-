// 解析 CSP 顶部导航结构：补货入库 是 hover 展开还是 <a>；并抓其子菜单真实链接
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

  await page.goto('https://csp.aliexpress.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  console.log('页面数(点击前):', ctx.pages().length);

  console.log('\n=== 1. 「补货入库」节点结构 ===');
  const node = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a,span,li,div'));
    const hit = all.filter((e) => (e.innerText || '').replace(/\s+/g, '').startsWith('补货入库'))
      .sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!hit) return null;
    const attrs = (e) => e ? [...e.attributes].map((a) => a.name + '=' + a.value.slice(0, 60)) : null;
    return {
      tag: hit.tagName, cls: hit.className,
      own: attrs(hit),
      parent: attrs(hit.parentElement),
      grand: attrs(hit.parentElement && hit.parentElement.parentElement),
      outer: hit.outerHTML.slice(0, 700),
    };
  });
  console.log(JSON.stringify(node, null, 1));

  console.log('\n=== 2. 悬停后可见的子菜单 ===');
  try {
    await page.locator('text=补货入库').first().hover({ timeout: 8000 });
    await sleep(3000);
  } catch (e) { console.log('hover 失败: ' + e.message); }

  const after = await page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    };
    const items = Array.from(document.querySelectorAll('a,li,[role=menuitem],div[class*=item],div[class*=Item]'))
      .filter(vis)
      .map((e) => ({
        t: (e.innerText || '').replace(/\s+/g, ' ').trim(),
        href: e.getAttribute && e.getAttribute('href'),
        data: [...e.attributes].filter((a) => /data|url|path|to/i.test(a.name)).map((a) => a.name + '=' + a.value.slice(0, 70)),
      }))
      .filter((x) => x.t && x.t.length < 20 && /补货|入库|库存|仓|调拨|发|明细|管理|监控/.test(x.t));
    return [...new Map(items.map((i) => [i.t + (i.href || ''), i])).values()].slice(0, 40);
  });
  console.log(JSON.stringify(after, null, 1));

  console.log('\n=== 3. 页面数(悬停后):', ctx.pages().length);
  ctx.pages().forEach((p, i) => console.log('  [' + i + ']', p.url().slice(0, 120)));

  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
