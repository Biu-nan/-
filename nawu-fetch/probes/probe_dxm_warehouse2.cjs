// 店小秘 仓库模块侦察 v2（只读）：完整 dump 左侧模块菜单 + 导出按钮结构 + 子标签
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_recon.json';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/warehouse/warehouseProduct', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const data = await page.evaluate(() => {
    // 左侧整棵菜单（包含层级）
    const nav = Array.from(document.querySelectorAll('a, [class*=menu-item], [class*=nav-item]'))
      .map((e) => ({ t: (e.innerText || e.getAttribute('title') || '').replace(/\s+/g, ' ').trim(), href: e.getAttribute('href') || '' }))
      .filter((x) => x.t && x.href.includes('dianxiaomi'));
    // 仓库模块相关（按文本命中）
    const warehouseNav = nav.filter((x) => /仓库|库存|清单|调拨|盘点|出入库|采购/i.test(x.t));
    // 页内子标签（tabs）
    const tabs = Array.from(document.querySelectorAll('[class*=tab], [role=tab], .ant-tabs-tab, li[class*=tab]'))
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    // 导出相关按钮（保留相邻文本上下文）
    const exportBtns = Array.from(document.querySelectorAll('button, a, [class*=btn], span'))
      .map((e) => ({ t: (e.innerText || '').replace(/\s+/g, ' ').trim(), cls: (e.className || '').toString().slice(0, 50) }))
      .filter((x) => x.t && /仓库清单|自定导出|导入\/导出|导出|下载|数据/.test(x.t));
    // 页面中是否出现「仓库清单数据」「库存清单数据」字样（区分两个导出物）
    const bodyTextHits = Array.from(new Set((document.body.innerText || '').match(/仓库清单数据|库存清单数据|仓库清单|库存清单|仓库数据/g) || [])).filter(Boolean);
    return { url: location.href, title: document.title, warehouseNav, tabs, exportBtns, bodyTextHits };
  });
  fs.mkdirSync(require('path').dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log('written', OUT);
  console.log(JSON.stringify(data, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
