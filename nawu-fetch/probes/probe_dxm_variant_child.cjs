// 定向侦察：多变种子行到底在哪个容器（点开变种详情后）
'use strict';
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
const fs = require('fs');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_variant_child_recon.json';

(async () => {
  const res = { error: null };
  try {
    const page = await (await chromium.connectOverCDP('http://127.0.0.1:9223')).contexts()[0].newPage();
    await page.goto('https://www.dianxiaomi.com/web/dxmCommodityProduct/index', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(9000);
    await page.waitForSelector('.vxe-body--row', { timeout: 20000 }).catch(() => {});
    // 全新加载直接点 多变种（首操作可正常渲染）
    await page.evaluate(() => {
      const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
      const el = Array.from(document.querySelectorAll('div,span,li,a,label')).filter((e) => /^多变种\s*\(\d+\)$/.test(txt(e)) && e.getBoundingClientRect().width > 0).pop();
      if (el) el.click();
    });
    await sleep(9000);
    res.beforeExpand = await page.evaluate(() => ({ bodyRows: document.querySelectorAll('.vxe-body--row').length }));
    // 展开
    res.clicked = await page.evaluate(() => {
      const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
      const links = Array.from(document.querySelectorAll('a')).filter((e) => txt(e) === '变种详情' && e.getBoundingClientRect().width > 0);
      links.forEach((e) => e.click());
      return links.length;
    });
    await sleep(6000);
    res.afterExpand = await page.evaluate(() => {
      const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
      const bodyRows = Array.from(document.querySelectorAll('.vxe-body--row')).map((r) => ({
        cls: String(r.className).slice(0, 120),
        colids: Array.from(r.querySelectorAll('[colid]')).map((e) => e.getAttribute('colid')),
        text: txt(r).slice(0, 160),
      }));
      // 找所有含 SKU 关键字（QTJLC）的元素
      const withSku = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /QTJLC|圣老人/.test(txt(e))).map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 100), text: txt(e).slice(0, 120), parentCls: String(e.parentElement && e.parentElement.className).slice(0, 100) }));
      const tables = Array.from(document.querySelectorAll('.vxe-table')).map((t) => ({ cls: String(t.className).slice(0, 140), rows: t.querySelectorAll('.vxe-body--row').length, text: txt(t).slice(0, 100) }));
      return { bodyRowCount: bodyRows.length, bodyRows: bodyRows.slice(0, 12), withSku: withSku.slice(0, 10), tables: tables.slice(0, 6) };
    });
    await page.close().catch(() => {});
  } catch (e) { res.error = String((e && e.message) || e); }
  finally { fs.writeFileSync(OUT, JSON.stringify(res, null, 1), 'utf8'); console.log('WROTE', OUT, 'ERR=', res.error || 'none'); process.exit(0); }
})();
