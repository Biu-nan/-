// 店小秘 仓库清单 导出侦察 v2：用 .btn + 精确文本定位并点击，抓下载文件 + 自定导出弹窗
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const XLSX = require('xlsx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const OUT = path.join(RAW, 'dxm_export_recon.json');

function readTable(fp) {
  const wb = XLSX.readFile(fp, { cellDates: false, raw: false });
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sh, { defval: '', raw: false });
  return { sheet: wb.SheetNames[0], rows: rows.length, headers: Object.keys(rows[0] || {}) };
}

async function clickBtn(page, text) {
  return page.evaluate((t) => {
    const el = Array.from(document.querySelectorAll('a.btn, span.btn, button.btn, .btn'))
      .find((e) => (e.innerText || '').replace(/\s+/g, ' ').trim() === t);
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'CLICKED';
  }, text);
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/warehouse/warehouseProduct', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const result = {};
  const dlRef = { info: null };
  page.on('download', async (d) => {
    try {
      const fn = d.suggestedFilename();
      const target = path.join(RAW, fn);
      await d.saveAs(target);
      dlRef.info = { file: target, ...readTable(target) };
      result.lastDownload = dlRef.info;
    } catch (e) { result.dlErr = e.message.slice(0, 120); }
  });

  // 1) 仓库清单 按钮
  result.listBtn = await clickBtn(page, '仓库清单');
  await sleep(25000);
  result.listExport = dlRef.info;
  dlRef.info = null;

  // 2) 自定导出 按钮 -> 看弹窗
  result.customBtn = await clickBtn(page, '自定导出');
  await sleep(4000);
  result.customModal = await page.evaluate(() => {
    const m = document.querySelector('.ant-modal-content, [class*=modal-content], [class*=dialog]');
    if (!m) return null;
    return {
      title: (m.querySelector('.ant-modal-title, [class*=title]') || {}).innerText || '',
      fieldCount: m.querySelectorAll('label, input[type=checkbox], [class*=checkbox]').length,
      buttons: Array.from(m.querySelectorAll('button')).map((e) => (e.innerText || '').trim()).filter(Boolean),
    };
  });
  // 若有弹窗，尝试点「导出」/「确定」并等下载
  if (result.customModal) {
    const confirmTxt = result.customModal.buttons.find((b) => /导出|确定|确认|开始/i.test(b)) || result.customModal.buttons[result.customModal.buttons.length - 1];
    if (confirmTxt) {
      try {
        await page.evaluate((t) => {
          const b = Array.from(document.querySelectorAll('.ant-modal-content button, [class*=modal-content] button'))
            .find((e) => (e.innerText || '').includes(t));
          if (b) b.click();
        }, confirmTxt);
        await sleep(25000);
        result.customExport = dlRef.info;
      } catch (e) { result.customExportErr = e.message.slice(0, 100); }
    }
  }

  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
