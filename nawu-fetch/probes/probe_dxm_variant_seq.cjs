// 定向侦察：复现「组合页签 → 翻页 → 点多变种」序列，定位为何采不到
'use strict';
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
const fs = require('fs');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_variant_seq_recon.json';

const state = () => ({
  rows: document.querySelectorAll('.vxe-body--row').length,
  totalMatch: (document.body.innerText || '').match(/共\s*[\d,]+\s*条记录/),
  pagerText: (document.querySelector('.vxe-pager') || {}).innerText ? document.querySelector('.vxe-pager').innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : '',
  activeTab: (Array.from(document.querySelectorAll('div,span,li,a,label')).filter((e) => /^(全部|单品|组合|多变种|加工|有异常)\s*\(\d+\)$/.test((e.innerText || '').replace(/\s+/g, ' ').trim()) && /active|blue|#428bca|primary/.test(String(e.className))).map((e) => e.innerText.trim())[0]) || '',
});

(async () => {
  const res = { timeline: [], error: null };
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
      if (!el) return 'NOT_FOUND';
      el.click(); return 'CLICKED';
    }, name);
    const next = () => page.evaluate(() => { const b = document.querySelector('.vxe-pager--next-btn'); if (!b) return 'NO_BTN'; if (b.classList.contains('is--disabled')) return 'DISABLED'; b.click(); return 'CLICKED'; });

    // A. 组合 -> 第2页
    res.timeline.push({ step: 'click 组合', r: await clickTab('组合') });
    await sleep(6000);
    res.timeline.push({ step: '组合 p1', st: await page.evaluate(state) });
    res.timeline.push({ step: 'next', r: await next() });
    await sleep(4000);
    res.timeline.push({ step: '组合 p2', st: await page.evaluate(state) });

    // B. 点多变种，逐秒观察
    res.timeline.push({ step: 'click 多变种', r: await clickTab('多变种') });
    for (let i = 0; i < 10; i++) { await sleep(1500); res.timeline.push({ step: `多变种 +${(i + 1) * 1.5}s`, st: await page.evaluate(state) }); }

    // C. 若仍为 0，先回「组合」再点「多变种」（模拟从第1页切换）
    if (res.timeline[res.timeline.length - 1].st.rows === 0) {
      res.timeline.push({ step: '回点 组合', r: await clickTab('组合') });
      await sleep(5000);
      res.timeline.push({ step: '组合再点', st: await page.evaluate(state) });
      res.timeline.push({ step: '再点 多变种', r: await clickTab('多变种') });
      for (let i = 0; i < 6; i++) { await sleep(1500); res.timeline.push({ step: `多变种2 +${(i + 1) * 1.5}s`, st: await page.evaluate(state) }); }
    }
    await page.close().catch(() => {});
  } catch (e) { res.error = String((e && e.message) || e); }
  finally {
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1), 'utf8');
    console.log('WROTE', OUT, 'ERR=', res.error || 'none');
    process.exit(0);
  }
})();
