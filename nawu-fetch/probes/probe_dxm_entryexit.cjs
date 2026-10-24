// 店小秘 自营仓库「出入记录」侦察：表头 / 首行 HTML / 分页
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const OUT = path.join(RAW, 'dxm_entryexit_recon.json');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();

  await page.goto('https://www.dianxiaomi.com/web/privateWarehouse/entryAndExitRecordList', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const info = await page.evaluate(() => {
    const table = Array.from(document.querySelectorAll('table')).find((t) => t.querySelector('thead') && t.innerText.length > 50);
    const ths = table ? Array.from(table.querySelectorAll('thead th')).map((th) => (th.innerText || '').replace(/\s+/g, ' ').trim()) : [];
    const tbody = table ? table.querySelector('tbody') : null;
    const rowCount = tbody ? tbody.querySelectorAll('tr').length : 0;
    const firstRow = tbody ? tbody.querySelector('tr') : null;
    // 用 vxe 结构优先
    const vxeRow = document.querySelector('.vxe-body--row');
    const vxeCells = vxeRow ? Array.from(vxeRow.children).map((c, i) => ({ colid: c.getAttribute('colid'), text: (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80), html: (c.outerHTML || '').slice(0, 400) })) : [];
    const vxeThs = Array.from(document.querySelectorAll('.vxe-header--column')).map((th) => (th.innerText || '').replace(/\s+/g, ' ').trim());
    const pgMatch = (document.body.innerText || '').match(/共\s*([\d,]+)\s*条记录/);
    const total = pgMatch ? pgMatch[1] : null;
    // 是否有筛选/日期范围
    const filters = Array.from(document.querySelectorAll('input, select, .ant-select, button')).map((e) => (e.innerText || e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('name') || '')).filter((t) => t && /日期|时间|仓库|类型|单据|筛选|查询|搜索/.test(t)).slice(0, 20);
    return { ths, rowCount, vxeThs, vxeCells, total, filters, url: location.href };
  });

  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
