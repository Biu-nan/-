// 店小秘 侦察 v2：完整左侧菜单链接 + 商品管理首行单元格 HTML
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const OUT = path.join(RAW, 'dxm_pages_recon_v2.json');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();

  await page.goto('https://www.dianxiaomi.com/web/dxmCommodityProduct/index', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const sidebar = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a')).map((a) => ({ t: (a.innerText || '').replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') || '' }))
      .filter((x) => x.t && x.href && /web\//.test(x.href));
    const inOut = links.filter((x) => /出入|流水|记录|批次/.test(x.t));
    const prodRow = (() => {
      const r = document.querySelector('.vxe-body--row');
      if (!r) return null;
      return { cells: Array.from(r.children).map((c) => (c.outerHTML || '').slice(0, 500)), rowText: Array.from(r.children).map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 12) };
    })();
    return { totalLinks: links.length, inOutLinks: inOut, prodRow };
  });

  const result = { sidebar };
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
