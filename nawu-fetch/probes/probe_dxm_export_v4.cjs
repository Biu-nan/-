// 店小秘 仓库清单 侦察 v4：工具栏 DOM + 首行结构 + 点「导入/导出」捕获导出面板/任务中心
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const OUT = path.join(RAW, 'dxm_export_recon_v4.json');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/warehouse/warehouseProduct', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const structure = await page.evaluate(() => {
    // 工具栏按钮
    const toolbar = Array.from(document.querySelectorAll('[class*=toolbar], [class*=action], [class*=operate], .m-right10, [class*=btn-group]'))
      .map((e) => ({ cls: (e.className||'').toString().slice(0,40), btns: Array.from(e.querySelectorAll('a, button, [class*=btn]')).map(b=>(b.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean) }))
      .filter((x) => x.btns.length);
    // 首行 td 结构
    const tr = document.querySelector('tbody tr');
    const tds = tr ? Array.from(tr.querySelectorAll('td')).map((td) => ({
      text: (td.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      nestedTd: td.querySelectorAll('td').length,
      nestedTh: td.querySelectorAll('th, [class*=sub], [class*=child]').length,
    })) : [];
    const thead = Array.from(document.querySelectorAll('thead th')).map((th) => ({ text: (th.innerText||'').replace(/\s+/g,' ').trim(), colspan: th.getAttribute('colspan') }));
    return { toolbar, firstRowTdCount: tds.length, thead, tds };
  });

  // 点「导入/导出」主按钮
  const responses = [];
  page.on('response', (r) => { const u=r.url(); if(/export|download|import|task|async|warehouse/i.test(u)) responses.push({s:r.status(),u:u.slice(0,160)}); });
  const clickRes = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('button, a')).find((e) => /导入\/导出/.test(e.innerText||''));
    if (!el) return 'NOT_FOUND';
    el.click(); return 'CLICKED ' + (el.tagName) + ' ' + (el.className||'').slice(0,40);
  });
  await sleep(5000);
  const panel = await page.evaluate(() => {
    const ov = document.querySelector('[class*=dialog], [class*=drawer], [class*=modal], [class*=overlay], [class*=panel]');
    const allBtns = Array.from(document.querySelectorAll('button')).map((e)=>(e.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean);
    const visibleOverlayText = ov ? (ov.innerText||'').replace(/\s+/g,' ').slice(0,300) : null;
    return { overlayClass: ov ? (ov.className||'').toString().slice(0,60) : null, visibleOverlayText, allButtons: allBtns.slice(0,30) };
  });

  const result = { structure, clickRes, panel, responses: responses.slice(0, 25) };
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
