// 挖 dchain-web 系统的导航结构，定位「库存管理 / 实时库存明细」
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => /dchain-web/.test(p.url())) || await ctx.newPage();

  const r = await page.evaluate(() => {
    const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };

    const nav = Array.from(document.querySelectorAll(
      '[class*=menu],[class*=nav],[class*=side],[class*=tab],[role=menu],[role=menuitem],[role=tab],[role=navigation]'
    )).filter(vis).map((e) => ({
      tag: e.tagName, cls: (e.className || '').toString().slice(0, 60),
      t: txt(e).slice(0, 40), href: e.getAttribute('href'),
    })).filter((x) => x.t && x.t.length < 40);

    const anchors = Array.from(document.querySelectorAll('a[href]')).filter(vis)
      .map((a) => txt(a) + ' :: ' + a.getAttribute('href')).filter((t) => t.length > 4).slice(0, 40);

    // 页面上所有不含空格的短文本按钮式元素（疑似菜单项）
    const shorts = [...new Set(Array.from(document.querySelectorAll('div,span,li,a'))
      .filter(vis).map(txt).filter((t) => t && t.length <= 8 && !/^\d/.test(t)))].slice(0, 120);

    // 所有含 path/data-* 路由属性的元素
    const routes = [...new Set(Array.from(document.querySelectorAll('[path],[data-path],[data-url],[data-href],[to]'))
      .map((e) => (txt(e) || e.getAttribute('name') || '') + ' => ' +
        (e.getAttribute('path') || e.getAttribute('data-path') || e.getAttribute('data-url') || e.getAttribute('data-href') || e.getAttribute('to') || ''))
      .filter((x) => x.length > 4))].slice(0, 60);

    return { href: location.href, nav: nav.slice(0, 40), anchors, shorts, routes };
  });
  console.log('URL:', r.href.slice(0, 130));
  console.log('\n=== 导航类元素 ===');
  r.nav.forEach((n) => console.log('  <' + n.tag + '> .' + n.cls + ' | ' + n.t + (n.href ? ' | ' + n.href : '')));
  console.log('\n=== anchors ===');
  r.anchors.forEach((a) => console.log('  ' + a.slice(0, 120)));
  console.log('\n=== 路由属性 ===');
  r.routes.forEach((x) => console.log('  ' + x.slice(0, 130)));
  console.log('\n=== 短文本元素 ===');
  console.log('  ' + r.shorts.join(' | '));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
