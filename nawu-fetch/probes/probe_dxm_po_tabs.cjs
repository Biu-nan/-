// 采购订单 页签结构 + 点击效果 侦察（只读）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_po_tabs_recon.json';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/purchasing/order/draft/manualPurchasing', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);
  const res = { at: new Date().toISOString() };

  res.tabEls = await page.evaluate(() => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    const cands = [];
    for (const e of document.querySelectorAll('a, li, span, div, button')) {
      const t = txt(e);
      if (!t || t.length > 12) continue;
      if (/^(全部|草稿箱|手动采购|1688采购|待审核|待到货|已完成|已取消)(\(\d+\))?$/.test(t)) {
        cands.push({ tag: e.tagName, cls: (e.className || '').toString().slice(0, 70), t, href: e.getAttribute('href') || '' });
      }
    }
    return cands.slice(0, 60);
  });
  console.log('TAB_ELS=' + JSON.stringify(res.tabEls.slice(0, 30), null, 1));

  // 尝试点击「待到货」并观察行数
  res.afterClick = await page.evaluate(() => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    const el = Array.from(document.querySelectorAll('a, li, span, div, button')).find((e) => /^待到货(\(\d+\))?$/.test(txt(e)));
    if (el) { el.click(); return 'CLICKED:' + el.tagName + '.' + (el.className || '').toString().slice(0, 40); }
    return 'NOT_FOUND';
  });
  await sleep(6000);
  res.rowsAfter = await page.evaluate(() => ({
    vxeRows: document.querySelectorAll('.vxe-body--row').length,
    total: (document.body.innerText.match(/共\s*([\d,]+)\s*条记录/) || [])[1] || null,
    url: location.href,
  }));
  console.log('AFTER_CLICK=' + res.afterClick);
  console.log('ROWS_AFTER=' + JSON.stringify(res.rowsAfter));

  // dump 首行单元格 colid+文本
  res.sampleRow = await page.evaluate(() => {
    const row = document.querySelector('.vxe-body--row');
    if (!row) return null;
    return Array.from(row.children).map((c) => ({ colid: c.getAttribute('colid'), t: ((c.innerText || '') || '').replace(/\s+/g, ' ').trim().slice(0, 120) }));
  });
  console.log('SAMPLE_ROW=' + JSON.stringify(res.sampleRow));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  console.log('written ' + OUT);
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
