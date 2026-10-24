// 店小秘 仓库模块侦察（只读，不改任何数据）
// 目的：定位「仓库清单」和「仓库清单数据」到底在哪、各自的导出按钮是什么
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/warehouse/warehouseProduct', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const info = await page.evaluate(() => {
    // 左侧菜单所有可点击项
    const navItems = Array.from(document.querySelectorAll('a, [class*=menu-item], [class*=nav-item], li'))
      .map((e) => ({ t: (e.innerText || e.getAttribute('title') || '').replace(/\s+/g, ' ').trim(), href: e.getAttribute('href') || '' }))
      .filter((x) => x.t && (x.href.includes('dianxiaomi') || /仓库|库存|清单|数据/i.test(x.t)))
      .slice(0, 60);
    // 导出/下载类按钮
    const btns = Array.from(document.querySelectorAll('button, a, [class*=btn]'))
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((t) => /导出|下载|excel|Excel|数据|清单|打印/i.test(t))
      .slice(0, 40);
    // 表头
    const headers = Array.from(document.querySelectorAll('th')).map((t) => (t.innerText || '').trim()).filter(Boolean);
    // 分页/总数
    const total = (document.body.innerText || '').match(/共\s*([\d,]+)\s*(条|项|个)/);
    return {
      url: location.href,
      title: document.title,
      navItems,
      exportButtons: btns,
      headers,
      totalText: total ? total[1] : null,
      rowCount: document.querySelectorAll('tbody tr').length,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
