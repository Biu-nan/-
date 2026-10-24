// 只读侦察 v3：商品管理 类型页签 + 导入/导出 下拉（hover/click 双策略）
'use strict';
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
const fs = require('fs');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_product_tabs_recon.json';

(async () => {
  const res = { steps: [], error: null };
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
    const ctx = browser.contexts()[0];
    const page = await ctx.newPage();
    await page.goto('https://www.dianxiaomi.com/web/dxmCommodityProduct/index', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(9000);
    await page.waitForSelector('.vxe-body--row', { timeout: 20000 }).catch(() => {});

    // 0) 导入/导出 元素结构
    res.ieEl = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*')).filter((e) => (e.innerText || '').replace(/\s+/g, ' ').trim() === '导入/导出');
      return els.map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 100), parentCls: String(e.parentElement && e.parentElement.className).slice(0, 100), html: e.outerHTML.slice(0, 300) })).slice(0, 5);
    });

    // 1) 类型页签文本 + 计数
    const tabInfo = await page.evaluate(() => {
      const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const cands = Array.from(document.querySelectorAll('div,span,li,a,label')).filter((e) => vis(e) && /^(全部|单品|组合|多变种|加工|有异常)\s*\(\d+\)$/.test(txt(e)));
      return [...new Set(cands.map((e) => txt(e)))];
    });
    res.typeTabs = tabInfo;

    // 2) 点「组合」页签，看行数与列
    const clickTab = async (name) => page.evaluate((name) => {
      const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const el = Array.from(document.querySelectorAll('div,span,li,a,label')).filter((e) => vis(e) && new RegExp('^' + name + '\\s*\\(\\d+\\)$').test(txt(e))).pop();
      if (!el) return 'NOT_FOUND';
      el.click(); return 'CLICKED:' + txt(el);
    }, name);

    res.comboClick = await clickTab('组合');
    await sleep(5000);
    res.combo = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.vxe-body--row'));
      const t = (document.body.innerText || '').match(/第[\d\-,]+条[，,]共\s*([\d,]+)\s*条记录/);
      const first = rows[0];
      return { rowCount: rows.length, totalText: t ? t[1] : '', sample: first ? (first.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 260) : '' };
    });

    // 3) hover 打开 导入/导出
    const ie = await page.$('text=导入/导出').catch(() => null);
    if (ie) { await ie.hover().catch(() => {}); await sleep(1200); await ie.click().catch(() => {}); }
    await sleep(2000);
    res.afterIe = await page.evaluate(() => {
      const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const boxes = Array.from(document.querySelectorAll('div,ul')).filter((e) => vis(e) && /drop|popover|overlay|dropdown|menu|modal|drawer/i.test(String(e.className) || ''));
      return {
        boxes: boxes.map((e) => ({ cls: String(e.className).slice(0, 90), text: txt(e).slice(0, 300) })).filter((x) => x.text).slice(0, 15),
        items: [...new Set(Array.from(document.querySelectorAll('a,li,span,div,button')).filter((e) => vis(e) && /导入|导出|模板/.test(txt(e)) && txt(e).length < 14).map(txt))].slice(0, 30),
      };
    });

    await page.close().catch(() => {});
  } catch (e) { res.error = String((e && e.message) || e); }
  finally {
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1), 'utf8');
    console.log('WROTE', OUT, 'ERR=', res.error || 'none');
    process.exit(0);
  }
})();
