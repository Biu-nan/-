// 诊断：把导出弹窗的 DOM 结构原样 dump 出来，确认选项的真实组件
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  await page.goto(
    'https://dchain-web.aliexpress.com/pages/aechoice/inventory_distribution_details_management?channelId=2443536',
    { waitUntil: 'domcontentloaded', timeout: 90000 }
  );
  await sleep(18000);
  try { await page.getByText('实时库存明细', { exact: true }).first().click({ timeout: 8000 }); } catch (e) {}
  await sleep(15000);

  console.log('=== 点导出数据 ===');
  try { await page.getByText('导出数据', { exact: true }).first().click({ timeout: 8000 }); } catch (e) { console.log('点击失败'); }
  await sleep(5000);

  const r = await page.evaluate(() => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
    // 找包含「品仓维度」文字的最外层容器
    const hits = Array.from(document.querySelectorAll('div,section,form'))
      .filter(vis)
      .filter((e) => (e.innerText || '').includes('品仓维度') && (e.innerText || '').includes('非零数据'));
    hits.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    const box = hits[0];

    // 收集所有 class 里带 radio/check 的元素（含隐藏的）
    const radiosAll = Array.from(document.querySelectorAll('[class*=radio],[class*=Radio],[class*=check],[class*=Check]'))
      .map((e) => ({
        tag: e.tagName,
        cls: (e.className || '').toString().slice(0, 80),
        vis: vis(e),
        t: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24),
      })).slice(0, 40);

    return {
      found: !!box,
      boxCls: box ? (box.className || '').toString().slice(0, 120) : null,
      boxHtml: box ? box.outerHTML.slice(0, 3500) : null,
      radiosAll,
      inputDump: Array.from(document.querySelectorAll('input')).map((i) => ({
        type: i.type, cls: (i.className || '').toString().slice(0, 50),
        name: i.name, value: i.value, vis: vis(i), checked: i.checked,
      })).slice(0, 30),
    };
  });
  console.log('找到容器:', r.found, '| class:', r.boxCls);
  console.log('\n=== 弹窗 HTML（前 3500 字符）===');
  console.log(r.boxHtml);
  console.log('\n=== 所有 radio/check 类元素 ===');
  console.log(JSON.stringify(r.radiosAll, null, 1));
  console.log('\n=== input 元素 ===');
  console.log(JSON.stringify(r.inputDump, null, 1));

  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
