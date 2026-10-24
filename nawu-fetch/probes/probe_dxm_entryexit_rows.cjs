// 出入记录 行配对侦察：打印前 6 个 .vxe-body--row 的 colid + 文本
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const OUT = path.join(RAW, 'dxm_entryexit_rows.json');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/privateWarehouse/entryAndExitRecordList', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const rows = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('.vxe-body--row')).slice(0, 6);
    return trs.map((tr, idx) => ({
      idx,
      cellCount: tr.children.length,
      cells: Array.from(tr.children).map((c) => ({ colid: c.getAttribute('colid'), rowspan: c.getAttribute('rowspan') || '', text: (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) })),
    }));
  });
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
