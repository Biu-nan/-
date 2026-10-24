// 店小秘 采购/供货商/出入记录 侦察（只读，不点任何写操作）
// 目的：拿到 C6R 需要的真实导航路径 + 筛选控件 + 表格列头，避免盲写采集器
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_purchase_supplier_recon.json';

const NAV_HINTS = /采购|供货|供应商|出入|仓库|库存|调拨|盘点/;

async function dumpPage(page, label) {
  await sleep(9000);
  const data = await page.evaluate((lb) => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    // 全站左侧菜单（含层级 href）
    const nav = Array.from(document.querySelectorAll('a'))
      .map((e) => ({ t: txt(e), href: e.getAttribute('href') || '' }))
      .filter((x) => x.t && x.href && x.href.includes('/web/'));
    // 表头
    const ths = Array.from(document.querySelectorAll('th, .vxe-header--column .vxe-cell'))
      .map((e) => txt(e)).filter(Boolean);
    // 工具栏/按钮
    const btns = Array.from(document.querySelectorAll('button, a.btn, [class*=btn], .el-button, span'))
      .map((e) => ({ t: txt(e), cls: (e.className || '').toString().slice(0, 60) }))
      .filter((x) => x.t && x.t.length < 24)
      .filter((x) => /导出|导入|筛选|搜索|查询|下载|全部|确定|高级/.test(x.t));
    // 时间/日期筛选控件
    const inputs = Array.from(document.querySelectorAll('input')).map((e) => ({
      ph: e.getAttribute('placeholder') || '', cls: (e.className || '').toString().slice(0, 50),
      val: (e.value || '').slice(0, 30), visible: !!(e.offsetWidth || e.offsetHeight),
    })).filter((x) => x.visible);
    // 分页总数
    const m = (document.body.innerText || '').match(/共\s*([\d,]+)\s*[条项]/);
    return {
      label: lb, url: location.href, title: document.title,
      totalText: m ? m[1] : null,
      rowCount: document.querySelectorAll('.vxe-body--row, tbody tr').length,
      headers: [...new Set(ths)].slice(0, 40),
      buttons: [...new Set(btns.map((b) => b.t))].slice(0, 40),
      dateInputs: inputs.slice(0, 12),
      navLinks: [...new Set(nav.map((n) => n.t + ' -> ' + n.href))],
    };
  }, label);
  return data;
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  const result = { at: new Date().toISOString(), pages: [], navAll: [] };

  await page.goto('https://www.dianxiaomi.com/web/warehouse/warehouseProduct', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(10000);

  // 1) 从落地页抓全站左侧菜单
  const navAll = await page.evaluate(() => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    return [...new Set(Array.from(document.querySelectorAll('a[href*="/web/"]'))
      .map((e) => txt(e) + ' -> ' + (e.getAttribute('href') || '')).filter((s) => s && !s.startsWith(' -> ')))];
  });
  result.navAll = navAll;
  console.log('NAV_COUNT=' + navAll.length);

  // 2) 候选页面（若不存在会 404/跳转，观察结果）
  const candidates = [
    ['purchaseOrder', 'https://www.dianxiaomi.com/web/purchase/purchaseOrder'],
    ['purchaseOrderList', 'https://www.dianxiaomi.com/web/purchase/order'],
    ['supplier', 'https://www.dianxiaomi.com/web/purchase/supplier'],
    ['supplierList', 'https://www.dianxiaomi.com/web/purchase/supplierList'],
    ['entryExit', 'https://www.dianxiaomi.com/web/privateWarehouse/entryAndExitRecordList'],
    ['warehouseProduct', 'https://www.dianxiaomi.com/web/warehouse/warehouseProduct'],
    ['product', 'https://www.dianxiaomi.com/web/dxmCommodityProduct/index'],
  ];
  for (const [label, url] of candidates) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const d = await dumpPage(page, label);
      result.pages.push(d);
      console.log(`== ${label} :: ${d.url} :: rows=${d.rowCount} total=${d.totalText} headers=${d.headers.length}`);
    } catch (e) {
      result.pages.push({ label, url, error: e.message.slice(0, 160) });
      console.log(`== ${label} :: ERROR ${e.message.slice(0, 120)}`);
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log('written ' + OUT);
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
