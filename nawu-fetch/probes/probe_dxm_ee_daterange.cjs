// 出入记录 时间=自定义 生效方式探测（只读，逐个策略试）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'https://www.dianxiaomi.com/web/privateWarehouse/entryAndExitRecordList';
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_ee_daterange_recon.json';

const readState = (page) => page.evaluate(() => {
  const t = document.body.innerText || '';
  const total = (t.match(/共\s*([\d,]+)\s*条记录/) || [])[1] || null;
  const vals = Array.from(document.querySelectorAll('.ant-picker input')).map((i) => i.value);
  const ph = Array.from(document.querySelectorAll('.ant-picker input')).map((i) => i.getAttribute('placeholder'));
  const days = new Set(Array.from(document.querySelectorAll('.vxe-body--row')).map((r) => {
    const c = r.querySelector('[colid="col_11"]'); const m = c ? ((c.innerText || '').match(/\d{4}-\d{2}-\d{2}/) || [])[0] : null; return m;
  }).filter(Boolean));
  return { total, pickerVals: vals, pickerPh: ph, firstPageDays: [...days].sort() };
});

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  const res = { at: new Date().toISOString(), steps: [] };

  // 策略A：点「自定义」后再看控件
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(11000);
  res.steps.push({ s: 'initial', ...(await readState(page)) });

  // 策略B：Playwright fill + Enter
  try {
    await page.getByText('自定义', { exact: true }).first().click({ timeout: 5000 });
    await sleep(2500);
    res.steps.push({ s: 'after-自定义-click', ...(await readState(page)) });
  } catch (e) { res.steps.push({ s: 'click-自定义', error: e.message.slice(0, 80) }); }

  try {
    const s = page.getByPlaceholder('开始日期');
    if (await s.count()) { await s.first().click(); await s.first().fill('2026-09-06'); await sleep(600); await page.keyboard.press('Enter'); await sleep(800); }
    const e2 = page.getByPlaceholder('结束日期');
    if (await e2.count()) { await e2.first().click(); await e2.first().fill('2026-10-10'); await sleep(600); await page.keyboard.press('Enter'); await sleep(800); }
    await page.keyboard.press('Enter');
    await sleep(3500);
    res.steps.push({ s: 'after-fill', ...(await readState(page)) });
  } catch (e) { res.steps.push({ s: 'fill', error: e.message.slice(0, 120) }); }

  // 策略C：点搜索
  try {
    await page.getByText('搜索', { exact: true }).first().click({ timeout: 5000 });
    await sleep(5000);
    res.steps.push({ s: 'after-搜索', ...(await readState(page)) });
  } catch (e) { res.steps.push({ s: 'search', error: e.message.slice(0, 80) }); }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  for (const st of res.steps) console.log(JSON.stringify(st).slice(0, 400));
  console.log('written ' + OUT);
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
