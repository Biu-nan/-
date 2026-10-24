// 只读探针：确认店小秘「库存清单」与「商品信息」页的抓取可行性
// 通过 CDP 接管现有 Chrome(9223)，新开 tab，读完即关，不调用 browser.close()（会关掉用户浏览器）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');

const TARGETS = [
  ['A_库存清单', 'https://www.dianxiaomi.com/web/warehouse/warehouseProduct'],
  ['B_商品信息', 'https://www.dianxiaomi.com/web/dxmCommodityProduct/index'],
];

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  for (const [label, url] of TARGETS) {
    console.log('\n================ ' + label + ' ================');
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForTimeout(8000);

      const info = await page.evaluate(() => {
        const txt = (e) => (e && e.innerText ? e.innerText.trim() : '');
        const ths = Array.from(document.querySelectorAll('th')).map(txt).filter(Boolean);
        const selectors = ['tbody tr', '.el-table__row', '.ant-table-row', '.vxe-body--row'];
        const rows = selectors.reduce((n, s) => Math.max(n, document.querySelectorAll(s).length), 0);
        const pagers = Array.from(document.querySelectorAll('.el-pagination, .ant-pagination, .vxe-pager, [class*=pagination]'))
          .map(txt).filter(Boolean);
        const btns = Array.from(document.querySelectorAll('button, a.el-button, .el-dropdown-link'))
          .map(txt).filter((t) => t && t.length < 14);
        const links = Array.from(document.querySelectorAll('a[href*="warehouse"], a[href*="Commodity"], a[href*="sku"], a[href*="Sku"]'))
          .slice(0, 12).map((a) => a.getAttribute('href') + ' :: ' + txt(a));
        return {
          title: document.title,
          href: location.href,
          tableCount: document.querySelectorAll('table').length,
          rowCount: rows,
          headers: [...new Set(ths)].slice(0, 70),
          pagination: [...new Set(pagers)].slice(0, 6),
          buttons: [...new Set(btns)].slice(0, 40),
          relatedLinks: [...new Set(links)],
          bodyHead: (document.body.innerText || '').slice(0, 900),
        };
      });
      console.log(JSON.stringify(info, null, 1));
    } catch (e) {
      console.log('ERR: ' + e.message);
    }
  }

  await page.close();
  console.log('\n[探针完成，tab 已关闭]');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
