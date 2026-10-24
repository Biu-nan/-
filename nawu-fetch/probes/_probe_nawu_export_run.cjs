// 完整走通导出：选「品仓维度 + 所有数据」→ 确认 → 捕获下载文件到 纳物采购最新数据/_raw
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const PORT = process.argv[2] || '14767';
const OUT = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  await page.goto('https://dchain-web.aliexpress.com/pages/aechoice/inventory_distribution_details_management?channelId=2443536',
    { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(18000);
  try { await page.getByText('实时库存明细', { exact: true }).first().click({ timeout: 8000 }); } catch (e) {}
  await sleep(15000);

  console.log('=== 1. 打开导出弹窗 ===');
  try { await page.getByText('导出数据', { exact: true }).first().click({ timeout: 8000 }); } catch (e) { console.log('点击失败 ' + e.message.slice(0, 70)); }
  await sleep(5000);

  console.log('=== 2. 弹窗内 radio 结构 ===');
  const radios = await page.evaluate(() => {
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    return Array.from(document.querySelectorAll('input[type=radio]')).filter(vis).map((r, i) => {
      const wrap = r.closest('label') || r.parentElement;
      return {
        i, name: r.name, value: r.value, checked: r.checked,
        label: wrap ? (wrap.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30) : '',
      };
    });
  });
  console.log(JSON.stringify(radios, null, 1));

  console.log('=== 3. 选择 品仓维度 + 所有数据 ===');
  const picked = await page.evaluate(() => {
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const radios = Array.from(document.querySelectorAll('input[type=radio]')).filter(vis);
    const info = radios.map((r, i) => ({ i, el: r, t: ((r.closest('label') || r.parentElement || {}).innerText || '').trim() }));
    // 找到「品仓维度」所在区块内的 所有数据 radio
    const all = Array.from(document.querySelectorAll('*')).filter(vis);
    let scope = null;
    for (const e of all) {
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
      if (/^品仓维度\s*所有数据\s*非零数据/.test(t) && t.length < 120) { scope = e; break; }
    }
    if (!scope) return { ok: false, reason: '未找到品仓维度区块' };
    const rs = Array.from(scope.querySelectorAll('input[type=radio]')).filter(vis);
    if (rs.length < 2) return { ok: false, reason: '品仓维度区块内 radio 数=' + rs.length };
    rs[0].click();
    return { ok: true, clicked: rs[0].name + '=' + rs[0].value, count: rs.length };
  });
  console.log(JSON.stringify(picked));
  await sleep(2500);

  const checkedNow = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input[type=radio]')).filter((r) => r.checked)
      .map((r) => ({ name: r.name, value: r.value })));
  console.log('当前选中:', JSON.stringify(checkedNow));

  console.log('=== 4. 确认导出并监听下载 ===');
  let dl = null;
  page.on('download', async (d) => {
    const target = path.join(OUT, d.suggestedFilename());
    try { await d.saveAs(target); dl = { file: target, size: fs.statSync(target).size }; }
    catch (e) { dl = { err: e.message.slice(0, 90), name: d.suggestedFilename() }; }
  });

  const confirmTexts = ['确定', '确认', '导出', '提交', '导出数据'];
  for (const t of confirmTexts) {
    try {
      const loc = page.locator(`[role=dialog] button:has-text("${t}"), [class*=dialog] button:has-text("${t}"), [class*=modal] button:has-text("${t}")`).first();
      if (await loc.count() > 0) { await loc.click({ timeout: 6000 }); console.log('已点击确认按钮: ' + t); break; }
    } catch (e) { /* next */ }
  }
  await sleep(15000);

  console.log('下载结果:', JSON.stringify(dl));
  const tail = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(-350));
  console.log('页面尾部提示:', tail);

  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
