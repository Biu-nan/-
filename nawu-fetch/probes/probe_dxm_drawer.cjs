// 店小秘 导入/导出 抽屉侦察：点主按钮后 dump 抽屉结构 + 全部按钮 + 导出/任务相关元素
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const OUT = path.join(RAW, 'dxm_drawer.json');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/warehouse/warehouseProduct', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const clickRes = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('button, a')).find((e) => /导入\/导出/.test(e.innerText || ''));
    if (!el) return 'NOT_FOUND';
    el.click(); return 'CLICKED';
  });
  await sleep(5000);

  const drawer = await page.evaluate(() => {
    const overlays = Array.from(document.querySelectorAll('[class*=drawer], [class*=dialog], [class*=modal], [class*=popup], [class*=sheet], [class*=panel]'));
    const big = overlays.filter((o) => (o.innerText || '').length > 50).map((o) => ({ cls: (o.className||'').toString().slice(0,60), text: (o.innerText||'').replace(/\s+/g,' ').trim().slice(0,400) }));
    const allButtons = Array.from(document.querySelectorAll('button')).map((e) => (e.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean);
    const exportRelated = Array.from(document.querySelectorAll('*')).map((e)=>(e.innerText||'').replace(/\s+/g,' ').trim()).filter((t)=>/导出|下载|任务|记录|模板|新建/.test(t) && t.length<40);
    const uniqueExport = [...new Set(exportRelated)].slice(0,40);
    return { overlayCount: overlays.length, bigOverlays: big, allButtons: allButtons.slice(0,40), uniqueExport };
  });

  const result = { clickRes, drawer };
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
