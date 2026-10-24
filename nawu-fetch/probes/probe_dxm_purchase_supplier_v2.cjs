// 店小秘 采购订单/供货商/供货关系 侦察 v2（只读）+ 自定导出字段面板
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_purchase_supplier_recon_v2.json';

async function dump(page, label) {
  await sleep(9000);
  return page.evaluate((lb) => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    const ths = Array.from(document.querySelectorAll('th, .vxe-header--column .vxe-cell')).map(txt).filter(Boolean);
    const btns = Array.from(document.querySelectorAll('button, a.btn, .el-button, [class*=btn]'))
      .map(txt).filter((t) => t && t.length < 22 && /导出|导入|筛选|搜索|查询|下载|全部|高级|新增/.test(t));
    const tabs = Array.from(document.querySelectorAll('[class*=tab], [role=tab], .ant-tabs-tab, li[class*=tab]')).map(txt).filter(Boolean);
    const m = (document.body.innerText || '').match(/共\s*([\d,]+)\s*[条项]/);
    return {
      label: lb, url: location.href, title: document.title, totalText: m ? m[1] : null,
      rowCount: document.querySelectorAll('.vxe-body--row, tbody tr').length,
      headers: [...new Set(ths)].slice(0, 50),
      buttons: [...new Set(btns)].slice(0, 40),
      tabs: [...new Set(tabs)].slice(0, 40),
    };
  }, label);
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  const res = { at: new Date().toISOString(), pages: [] };

  const targets = [
    ['采购订单', 'https://www.dianxiaomi.com/web/purchasing/order/draft/manualPurchasing'],
    ['采购跟单', 'https://www.dianxiaomi.com/web/purchasingFollow/list'],
    ['按单采购', 'https://www.dianxiaomi.com/web/purchasingToOrder/unPurchased'],
    ['采购建议', 'https://www.dianxiaomi.com/web/purchasing/proposal/privateWarehouse'],
    ['供货商', 'https://www.dianxiaomi.com/web/supply/supplier'],
    ['供货关系', 'https://www.dianxiaomi.com/web/supply/supplyRelation'],
  ];
  for (const [label, url] of targets) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const d = await dump(page, label);
      res.pages.push(d);
      console.log(`== ${label} rows=${d.rowCount} total=${d.totalText} headers=${d.headers.length} :: ${d.url}`);
      console.log('   H: ' + JSON.stringify(d.headers));
      console.log('   B: ' + JSON.stringify(d.buttons));
      console.log('   T: ' + JSON.stringify(d.tabs));
    } catch (e) {
      res.pages.push({ label, url, error: e.message.slice(0, 160) });
      console.log(`== ${label} ERROR ${e.message.slice(0, 120)}`);
    }
  }

  // 商品管理「自定导出」面板字段（只打开面板，不提交）
  try {
    await page.goto('https://www.dianxiaomi.com/web/dxmCommodityProduct/index', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(9000);
    const opened = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, a, span, div'))
        .find((e) => ((e.innerText || '').replace(/\s+/g, '').trim() === '自定导出'));
      if (btn) { btn.click(); return true; }
      return false;
    });
    await sleep(4000);
    const panel = await page.evaluate(() => {
      const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
      // 收集弹窗/抽屉内所有可勾选字段名
      const boxes = Array.from(document.querySelectorAll('.ant-modal, .ant-drawer, [class*=modal], [class*=drawer]'));
      const labels = [];
      for (const b of boxes) {
        for (const e of b.querySelectorAll('label, .ant-checkbox-wrapper, li, td, span')) {
          const t = txt(e);
          if (t && t.length < 24) labels.push(t);
        }
      }
      return { opened: boxes.length > 0, fieldLabels: [...new Set(labels)].slice(0, 120) };
    });
    res.exportPanel = { clickOpened: opened, ...panel };
    console.log('== 自定导出面板 clickOpened=' + opened + ' labels=' + (panel.fieldLabels || []).length);
    console.log('   F: ' + JSON.stringify((panel.fieldLabels || []).slice(0, 80)));
  } catch (e) {
    res.exportPanel = { error: e.message.slice(0, 160) };
    console.log('== 自定导出面板 ERROR ' + e.message.slice(0, 120));
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  console.log('written ' + OUT);
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
