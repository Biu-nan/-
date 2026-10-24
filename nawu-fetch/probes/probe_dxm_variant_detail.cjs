// 只读侦察：多变种行「变种详情」弹层内容（能否拿到真实 SKU / 子变种）
'use strict';
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
const fs = require('fs');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_variant_detail_recon.json';

(async () => {
  const res = { steps: [], error: null };
  try {
    const b = await chromium.connectOverCDP('http://127.0.0.1:9223');
    const page = await b.contexts()[0].newPage();
    await page.goto('https://www.dianxiaomi.com/web/dxmCommodityProduct/index', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(9000);
    await page.waitForSelector('.vxe-body--row', { timeout: 20000 }).catch(() => {});

    const clickTab = (name) => page.evaluate((name) => {
      const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const re = new RegExp('^' + name + '\\s*\\(\\d+\\)$');
      const el = Array.from(document.querySelectorAll('div,span,li,a,label')).filter((e) => vis(e) && re.test(txt(e))).pop();
      if (!el) return 'NOT_FOUND'; el.click(); return 'CLICKED';
    }, name);

    res.clickTab = await clickTab('多变种');
    await sleep(9000);
    res.rowInfo = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.vxe-body--row'));
      return rows.map((r) => { const c9 = r.querySelector('[colid="col_9"]'); return c9 ? (c9.innerText || '').replace(/\s+/g, ' ').trim() : ''; });
    });

    // 点第一行的「变种详情」
    res.clickDetail = await page.evaluate(() => {
      const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
      const a = Array.from(document.querySelectorAll('a')).find((e) => txt(e) === '变种详情' && e.getBoundingClientRect().width > 0);
      if (!a) return 'NOT_FOUND'; a.click(); return 'CLICKED';
    });
    await sleep(4000);
    res.modal = await page.evaluate(() => {
      const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const m = Array.from(document.querySelectorAll('.ant-modal, .ant-drawer, [class*=modal], [class*=drawer]')).filter((x) => vis(x) && txt(x))[0];
      if (!m) return { found: false };
      const rows = Array.from(m.querySelectorAll('table tr, .ant-table-row')).map(txt).filter(Boolean).slice(0, 10);
      return { found: true, title: txt(m.querySelector('.ant-modal-title, .ant-drawer-title') || m).slice(0, 80), text: txt(m).slice(0, 1200), rows, inputs: Array.from(m.querySelectorAll('input')).map((i) => i.value).filter(Boolean).slice(0, 20) };
    });
    // 截图留证
    await page.screenshot({ path: 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/variant_detail.png', fullPage: false }).catch(() => {});
    await page.close().catch(() => {});
  } catch (e) { res.error = String((e && e.message) || e); }
  finally {
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1), 'utf8');
    console.log('WROTE', OUT, 'ERR=', res.error || 'none');
    process.exit(0);
  }
})();
