// 只读侦察 v2：商品管理 导入/导出 下拉真实内容
// 手法：点击前后做 body 文本 diff + 抓所有弹层容器（含 portal）
'use strict';
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
const fs = require('fs');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_product_export_recon2.json';

(async () => {
  const res = { steps: [], error: null };
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
    const ctx = browser.contexts()[0];
    const page = await ctx.newPage();
    const dl = [];
    page.on('download', (d) => dl.push(d.suggestedFilename()));
    await page.goto('https://www.dianxiaomi.com/web/dxmCommodityProduct/index', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(9000);
    await page.waitForSelector('.vxe-body--row', { timeout: 20000 }).catch(() => {});

    const snapText = () => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim());
    const before = await snapText();

    // 点击 导入/导出
    await page.evaluate(() => {
      const t = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
      const el = Array.from(document.querySelectorAll('.ant-btn, button, a, span')).find((e) => t(e) === '导入/导出' && e.getBoundingClientRect().width > 0);
      if (el) el.click();
    });
    await sleep(1500);

    const after = await snapText();
    res.diff = after.replace(before.slice(0, 60), '').slice(0, 1500);

    // 抓所有可能的弹层
    res.overlays = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
      const boxes = Array.from(document.querySelectorAll('div,ul')).filter((e) => vis(e) && /drop|popover|overlay|dropdown|menu|tooltip/i.test(e.className || ''));
      return boxes.map((e) => ({ cls: String(e.className).slice(0, 120), text: txt(e).slice(0, 400) })).filter((x) => x.text).slice(0, 30);
    });

    // 找出点击后新增的可点项（小文本、可见、在浮层里）
    res.clickables = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
      return [...new Set(Array.from(document.querySelectorAll('a,li,button,span,div'))
        .filter((e) => vis(e) && txt(e) && txt(e).length < 12 && /导出|导入|模板|设置|字段/.test(txt(e)))
        .map((e) => txt(e)))].slice(0, 40);
    });

    // 直接找「导出商品」并点开，再抓弹窗
    const clicked = await page.evaluate(() => {
      const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
      const els = Array.from(document.querySelectorAll('a,li,button,span,div'));
      const el = els.reverse().find((e) => /^导出商品(信息)?$/.test(txt(e)) && e.getBoundingClientRect().width > 0);
      if (!el) return 'NOT_FOUND';
      el.click(); return 'CLICKED:' + txt(el);
    });
    res.clickExportProduct = clicked;
    await sleep(3000);

    res.afterExport = await page.evaluate(() => {
      const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
      const modals = Array.from(document.querySelectorAll('.ant-modal, .ant-drawer')).filter((m) => m.getBoundingClientRect().width > 0);
      return modals.map((m) => ({
        title: txt(m.querySelector('.ant-modal-title, .ant-drawer-title') || m).slice(0, 80),
        text: txt(m).slice(0, 1800),
        checks: [...new Set(Array.from(m.querySelectorAll('input[type=checkbox]')).map((c) => txt(c.closest('label') || c.parentElement)).filter(Boolean))].slice(0, 200),
        buttons: Array.from(m.querySelectorAll('button')).map(txt).filter(Boolean),
        selects: Array.from(m.querySelectorAll('.ant-select-selection-item, select')).map(txt).filter(Boolean).slice(0, 40),
      }));
    });

    res.downloads = dl;
    await page.close().catch(() => {});
  } catch (e) { res.error = String((e && e.message) || e); }
  finally {
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1), 'utf8');
    console.log('WROTE', OUT, 'ERR=', res.error || 'none');
    process.exit(res.error ? 1 : 0);
  }
})();
