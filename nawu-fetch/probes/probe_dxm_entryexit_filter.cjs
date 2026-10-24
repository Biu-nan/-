// 出入记录 时间筛选 / 自定导出 结构侦察（只读，不提交导出）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_entryexit_filter_recon.json';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto('https://www.dianxiaomi.com/web/privateWarehouse/entryAndExitRecordList', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(11000);

  const res = { at: new Date().toISOString() };

  // 1) 顶部筛选区所有控件（ant/picker/select/日期）+ 快捷时间标签
  res.filters = await page.evaluate(() => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    const pickers = Array.from(document.querySelectorAll('.ant-picker, .ant-picker-input, input[placeholder*="时间"], input[placeholder*="日期"], .ant-calendar-picker')).map((e) => ({
      cls: (e.className || '').toString().slice(0, 60), ph: e.getAttribute && e.getAttribute('placeholder'), t: txt(e).slice(0, 40),
    }));
    const quick = Array.from(document.querySelectorAll('a, span, li, button, label')).map(txt)
      .filter((t) => t && /今天|昨天|7天|30天|自定义|近|天以内|本周|本月/.test(t) && t.length < 20);
    return { pickers, quick: [...new Set(quick)].slice(0, 30) };
  });
  console.log('FILTER pickers=' + res.filters.pickers.length + ' quick=' + JSON.stringify(res.filters.quick));

  // 2) 点「自定导出」，dump 弹窗
  const clickRes = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('button, a, span, div')).find((e) => ((e.innerText || '').replace(/\s+/g, '').trim() === '自定导出'));
    if (el) { el.click(); return true; }
    return false;
  });
  await sleep(4000);
  res.exportDialog = await page.evaluate(() => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    const dlg = Array.from(document.querySelectorAll('.ant-modal, .ant-drawer, [role=dialog], [class*=dialog], [class*=modal]')).pop();
    if (!dlg) return { found: false, bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400) };
    const labels = Array.from(dlg.querySelectorAll('label, .ant-checkbox-wrapper, .ant-radio-wrapper, li, span, td')).map(txt).filter((t) => t && t.length < 26);
    const btns = Array.from(dlg.querySelectorAll('button, a.btn, .ant-btn')).map(txt).filter(Boolean).slice(0, 20);
    const pickers = Array.from(dlg.querySelectorAll('.ant-picker, input')).map((e) => ({ ph: e.getAttribute && e.getAttribute('placeholder') })).slice(0, 15);
    return { found: true, title: txt(dlg.querySelector('.ant-modal-title, [class*=title]')).slice(0, 40), labels: [...new Set(labels)].slice(0, 60), buttons: [...new Set(btns)], pickers };
  });
  res.exportDialogClickOk = clickRes;
  console.log('EXPORT_DIALOG found=' + res.exportDialog.found + ' labels=' + JSON.stringify((res.exportDialog.labels || []).slice(0, 40)) + ' btns=' + JSON.stringify(res.exportDialog.buttons || []));

  // 关闭弹窗（不提交）
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(1000);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  console.log('written ' + OUT);
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
