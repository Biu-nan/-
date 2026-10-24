// 出入记录 时间范围 生效策略 v2（只读）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'https://www.dianxiaomi.com/web/privateWarehouse/entryAndExitRecordList';
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/dxm_ee_daterange_recon2.json';

const readState = (page) => page.evaluate(() => {
  const t = document.body.innerText || '';
  const total = (t.match(/共\s*([\d,]+)\s*条记录/) || [])[1] || null;
  const visibleVals = Array.from(document.querySelectorAll('.ant-picker input'))
    .filter((i) => i.offsetWidth || i.offsetHeight).map((i) => ({ ph: i.getAttribute('placeholder'), v: i.value }));
  const days = new Set(Array.from(document.querySelectorAll('.vxe-body--row')).map((r) => {
    const c = r.querySelector('[colid="col_11"]'); return c ? ((c.innerText || '').match(/\d{4}-\d{2}-\d{2}/) || [])[0] : null;
  }).filter(Boolean));
  const seen = (t.match(/20\d\d-\d\d-\d\d/g) || []).length;
  return { total, visibleVals, firstPageDays: [...days].sort(), dateMentions: seen };
});

async function clickTimeAll(page) {
  return page.evaluate(() => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    // 找「时间」标签所在的筛选组，再在其中点「全部」
    const labels = Array.from(document.querySelectorAll('*')).filter((e) => txt(e) === '时间' && e.children.length === 0);
    for (const lab of labels) {
      let box = lab.parentElement;
      for (let up = 0; up < 4 && box; up++) {
        if (/今天/.test(box.innerText) && /昨天/.test(box.innerText)) {
          const btn = Array.from(box.querySelectorAll('a, span, button, li, label')).find((e) => txt(e) === '全部');
          if (btn) { btn.click(); return 'CLICKED_ALL_IN_TIME_GROUP'; }
        }
        box = box.parentElement;
      }
    }
    return 'NOT_FOUND';
  });
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  const res = { at: new Date().toISOString(), steps: [] };
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(11000);
  res.steps.push({ s: 'initial', ...(await readState(page)) });

  // 策略1：时间组内「全部」
  const r1 = await clickTimeAll(page);
  await sleep(6000);
  res.steps.push({ s: 'time=全部', click: r1, ...(await readState(page)) });
  res.strategy1 = { click: r1 };

  if (r1 === 'CLICKED_ALL_IN_TIME_GROUP') {
    const st = res.steps[res.steps.length - 1];
    if (st.total && parseInt(st.total) > 2000) { res.best = 'strategy1'; }
  }

  // 策略2：自定义 + 可见输入框 type + Enter
  if (!res.best) {
    try {
      await page.getByText('自定义', { exact: true }).first().click({ timeout: 5000 });
      await sleep(2500);
      const sIn = page.locator('.ant-picker input[placeholder="开始日期"]:visible').last();
      await sIn.click({ timeout: 6000 });
      await page.keyboard.type('2026-09-06', { delay: 40 });
      await sleep(500); await page.keyboard.press('Enter'); await sleep(800);
      const eIn = page.locator('.ant-picker input[placeholder="结束日期"]:visible').last();
      await eIn.click({ timeout: 6000 });
      await page.keyboard.type('2026-10-10', { delay: 40 });
      await sleep(500); await page.keyboard.press('Enter'); await sleep(800);
      await page.keyboard.press('Enter');
      await sleep(5000);
      res.steps.push({ s: 'custom-range', ...(await readState(page)) });
      const st = res.steps[res.steps.length - 1];
      if (st.total) res.best = 'strategy2';
    } catch (e) { res.steps.push({ s: 'custom-range', error: e.message.slice(0, 140) }); }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  for (const st of res.steps) console.log(JSON.stringify(st).slice(0, 420));
  console.log('BEST=' + res.best);
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
