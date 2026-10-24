// 诊断：消息中心里「下载文件」链接的 DOM 结构 + 新标签页内容
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];

  console.log('=== 当前所有页面 ===');
  ctx.pages().forEach((p, i) => console.log(`  [${i}] ${p.url().slice(0, 120)}`));

  const page = ctx.pages().find((p) => /dchain-web/.test(p.url()));
  if (!page) { console.log('找不到 dchain 页面'); process.exit(0); }

  console.log('\n=== 「下载文件」元素结构 ===');
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
    const hits = Array.from(document.querySelectorAll('a,button,span,div'))
      .filter((e) => (e.innerText || '').trim() === '下载文件' && vis(e))
      .slice(0, 4);
    const rows = Array.from(document.querySelectorAll('li,div'))
      .filter((e) => /实时库存数据/.test(e.innerText || '') && (e.innerText || '').length < 80 && vis(e))
      .slice(0, 3);
    return {
      dlCount: hits.length,
      dlSamples: hits.map((e) => ({
        tag: e.tagName,
        cls: (e.className || '').toString().slice(0, 70),
        href: e.getAttribute('href'),
        parentCls: e.parentElement ? (e.parentElement.className || '').toString().slice(0, 70) : null,
        grandCls: e.parentElement && e.parentElement.parentElement ? (e.parentElement.parentElement.className || '').toString().slice(0, 70) : null,
        outer: e.outerHTML.slice(0, 300),
      })),
      rowSamples: rows.map((e) => ({
        tag: e.tagName,
        cls: (e.className || '').toString().slice(0, 70),
        text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        outer: e.outerHTML.slice(0, 500),
      })),
    };
  });
  console.log(JSON.stringify(r, null, 1));

  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
