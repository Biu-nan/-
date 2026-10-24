// 只读侦察：多变种/加工 页签行为何采不到行
'use strict';
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
const fs = require('fs');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_variant_tab_recon.json';

(async () => {
  const res = { steps: [], error: null };
  try {
    const b = await chromium.connectOverCDP('http://127.0.0.1:9223');
    const ctx = b.contexts()[0];
    const page = await ctx.newPage();
    await page.goto('https://www.dianxiaomi.com/web/dxmCommodityProduct/index', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(9000);
    await page.waitForSelector('.vxe-body--row', { timeout: 20000 }).catch(() => {});

    const clickTab = (name) => page.evaluate((name) => {
      const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const re = new RegExp('^' + name + '\\s*\\(\\d+\\)$');
      const el = Array.from(document.querySelectorAll('div,span,li,a,label')).filter((e) => vis(e) && re.test(txt(e))).pop();
      if (!el) return 'NOT_FOUND';
      el.click(); return 'CLICKED';
    }, name);

    for (const tab of ['多变种', '加工']) {
      const c = await clickTab(tab);
      await sleep(7000);
      const dump = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.vxe-body--row'));
        const t = (document.body.innerText || '').match(/第[\d\-,]+条[，,]共\s*([\d,]+)\s*条记录/);
        const r0 = rows[0];
        const c9 = r0 ? r0.querySelector('[colid="col_9"]') : null;
        return {
          rowCount: rows.length,
          totalText: t ? t[1] : '',
          firstRowColIds: r0 ? Array.from(r0.querySelectorAll('[colid]')).map((e) => e.getAttribute('colid')) : [],
          firstRowHtml: r0 ? r0.innerHTML.slice(0, 900) : '',
          c9Html: c9 ? c9.innerHTML.slice(0, 700) : '',
          c9Text: c9 ? (c9.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300) : '',
          c9Anchor: c9 && c9.querySelector('a') ? (c9.querySelector('a').innerText || '').trim() : '',
        };
      });
      res.steps.push({ tab, click: c, ...dump });
    }
    await page.close().catch(() => {});
  } catch (e) { res.error = String((e && e.message) || e); }
  finally {
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1), 'utf8');
    console.log('WROTE', OUT, 'ERR=', res.error || 'none');
    process.exit(0);
  }
})();
