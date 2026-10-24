// 只读侦察：店小秘 商品管理 导入/导出 面板字段与导出方式
// 目的：确认缺口2（首选供应商/来源URL/1688配对/BOM/组合数量）能否从导出取得
// 铁律：只点击「打开弹窗/查看字段」，不点最终「导出/确定」提交，不产生任何业务写。
'use strict';
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_product_export_recon.json';

async function dump(page, label) {
  return page.evaluate((label) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
    const menus = Array.from(document.querySelectorAll('.ant-dropdown-menu-item, .ant-menu-item, .ant-dropdown li, [class*=dropdown] li')).filter(vis).map(txt).filter(Boolean);
    const checkLabels = Array.from(document.querySelectorAll('.ant-modal input[type=checkbox]')).map((c) => { const w = c.closest('label') || c.parentElement; return txt(w); }).filter(Boolean);
    const modal = document.querySelector('.ant-modal:not([style*="display: none"])');
    return {
      label,
      url: location.href,
      menuItems: [...new Set(menus)].slice(0, 80),
      modalTitle: modal ? txt(modal.querySelector('.ant-modal-title') || modal).slice(0, 120) : '',
      modalText: modal ? txt(modal).slice(0, 2500) : '',
      checkCount: checkLabels.length,
      checkLabels: [...new Set(checkLabels)].slice(0, 200),
      modalButtons: modal ? Array.from(modal.querySelectorAll('button')).map(txt).filter(Boolean) : [],
      hasExportCenter: /导出记录|下载中心|导出任务|我的导出/.test(document.body.innerText || ''),
    };
  }, label);
}

async function clickByText(page, re) {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const els = Array.from(document.querySelectorAll('button, .ant-btn, a, span, div, li'));
    const hit = els.find((e) => { const t = (e.innerText || '').replace(/\s+/g, ' ').trim(); const r = e.getBoundingClientRect(); return re.test(t) && t.length < 20 && r.width > 0 && r.height > 0; });
    if (!hit) return 'NOT_FOUND';
    hit.click();
    return 'CLICKED:' + (hit.innerText || '').replace(/\s+/g, ' ').trim();
  }, re.source);
}

(async () => {
  const res = { steps: [], error: null };
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
    const ctx = browser.contexts()[0];
    const page = await ctx.newPage();
    const dl = [];
    page.on('download', (d) => dl.push(d.suggestedFilename()));
    await page.goto('https://www.dianxiaomi.com/web/dxmCommodityProduct/index', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(9000);
    await page.waitForSelector('.vxe-body--row', { timeout: 20000 }).catch(() => {});
    res.steps.push(await dump(page, 'page-open'));

    // 工具栏里所有候选按钮
    res.toolbar = await page.evaluate(() => {
      const t = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
      return [...new Set(Array.from(document.querySelectorAll('.ant-btn, button')).map(t).filter(Boolean).filter((x) => x.length < 16))];
    });

    const c1 = await clickByText(page, /^导入\/导出$|^导入导出$|^导出$/);
    res.steps.push({ label: 'click-import-export', result: c1 });
    await sleep(1500);
    res.steps.push(await dump(page, 'after-import-export-click'));

    // 菜单里找导出商品 / 导出商品信息 / 自定导出
    const c2 = await clickByText(page, /导出商品|自定导出|导出信息|导出/);
    res.steps.push({ label: 'click-export-item', result: c2 });
    await sleep(2500);
    res.steps.push(await dump(page, 'after-export-item-click'));

    // 找「设置/自定字段」按钮
    const c3 = await clickByText(page, /导出设置|自定字段|选择字段|设置字段|字段设置|自定导出/);
    res.steps.push({ label: 'click-field-settings', result: c3 });
    await sleep(2000);
    res.steps.push(await dump(page, 'after-field-settings-click'));

    res.downloads = dl;
    await page.close().catch(() => {});
  } catch (e) {
    res.error = String(e && e.message || e);
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1), 'utf8');
    console.log('WROTE', OUT);
    console.log('ERROR:', res.error || 'none');
    console.log('DOWNLOADS:', JSON.stringify(res.downloads || []));
    process.exit(res.error ? 1 : 0);
  }
})();
