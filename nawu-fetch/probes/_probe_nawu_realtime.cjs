// 切到「实时库存明细」标签，抓列结构 + 分页总量 + 导出按钮行为
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const snap = (page) => page.evaluate(() => {
  const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
  const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const ths = [...new Set(Array.from(document.querySelectorAll('th')).filter(vis).map(txt).filter(Boolean))];
  const rows = Array.from(document.querySelectorAll('tbody tr')).slice(0, 3)
    .map((tr) => Array.from(tr.querySelectorAll('td')).map(txt));
  const total = (() => {
    const m = (document.body.innerText || '').match(/共\s*([\d,]+)\s*[项条]/);
    return m ? m[1] : null;
  })();
  return {
    href: location.href,
    headers: ths, sampleRows: rows,
    rowCount: document.querySelectorAll('tbody tr').length,
    totalText: total,
    activeTab: (document.querySelector('[class*=tab-item][class*=active], [class*=active][class*=tab]') || {}).innerText || null,
    buttons: [...new Set(Array.from(document.querySelectorAll('button,[role=button]')).filter(vis).map(txt).filter((t) => t && t.length < 16))],
  };
});

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto('https://dchain-web.aliexpress.com/pages/aechoice/inventory_distribution_details_management?channelId=2443536',
    { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(18000);

  console.log('=== 点击「实时库存明细」标签 ===');
  let ok = false;
  for (const how of [
    () => page.getByText('实时库存明细', { exact: true }).first().click({ timeout: 8000 }),
    () => page.locator('text=实时库存明细').first().click({ timeout: 8000 }),
  ]) { try { await how(); ok = true; break; } catch (e) {} }
  console.log('点击结果:', ok);
  await sleep(18000);

  const s = await snap(page);
  console.log(JSON.stringify(s, null, 1));

  console.log('\n=== 检查是否有导出弹窗/菜单 ===');
  try {
    await page.getByText('导出数据', { exact: true }).first().click({ timeout: 8000 });
    await sleep(4000);
    const pop = await page.evaluate(() => {
      const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
      const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      const dialogs = Array.from(document.querySelectorAll('[role=dialog],[class*=dialog],[class*=Dialog],[class*=modal],[class*=popup],[class*=overlay]'))
        .filter(vis).map(txt).filter(Boolean).slice(0, 6);
      return { dialogs, bodyTail: (document.body.innerText || '').replace(/\s+/g, ' ').slice(-600) };
    });
    console.log(JSON.stringify(pop, null, 1));
  } catch (e) { console.log('点击导出失败: ' + e.message.slice(0, 80)); }

  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
