// 诊断：点击「品仓维度->所有数据」后到底发生了什么（文本差分 + 截图 + 新标签）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const SHOT = 'F:/yikuaborder-deploy/纳物采购最新数据/logs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bodyText = (page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const pagesBefore = ctx.pages().length;
  const page = await ctx.newPage();

  await page.goto(
    'https://dchain-web.aliexpress.com/pages/aechoice/inventory_distribution_details_management?channelId=2443536',
    { waitUntil: 'domcontentloaded', timeout: 90000 }
  );
  await sleep(18000);
  try { await page.getByText('实时库存明细', { exact: true }).first().click({ timeout: 8000 }); } catch (e) {}
  await sleep(15000);

  console.log('视口:', JSON.stringify(await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))));
  const before = await bodyText(page);

  try { await page.getByText('导出数据', { exact: true }).first().click({ timeout: 8000 }); } catch (e) {}
  await sleep(4000);

  console.log('\n=== 菜单项几何信息 ===');
  const geo = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .next-menu-item'));
    return items.map((e, i) => {
      const b = e.getBoundingClientRect();
      return { i, text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20), rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } };
    });
  });
  console.log(JSON.stringify(geo, null, 1));

  const xp =
    '//li[contains(@class,"next-menu-group-label") and normalize-space(@title)="品仓维度"]' +
    '/following-sibling::*[1]//li[contains(@class,"next-menu-item")][1]';
  const target = page.locator('xpath=' + xp).first();

  console.log('\n=== 点击前 innerHTML 摘要 ===');
  console.log((await target.evaluate((e) => e.outerHTML.slice(0, 400))).replace(/\s+/g, ' '));

  console.log('\n=== 执行点击 ===');
  try {
    await target.click({ timeout: 10000 });
    console.log('click ok');
  } catch (e) {
    console.log('click 失败: ' + e.message.slice(0, 120));
  }

  for (const t of [2000, 8000, 20000, 35000]) {
    await sleep(t === 2000 ? 2000 : 6000);
    const now = await bodyText(page);
    // 找出新增的短文本片段
    const added = now.length > before.length ? now.slice(0, 300) : '';
    const toast = await page.evaluate(() => {
      const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
      return Array.from(document.querySelectorAll('[class*=toast],[class*=message],[class*=notice],[role=alert],[class*=notification]'))
        .filter(vis).map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6);
    });
    console.log(`\n[+${t}ms] 页面数=${ctx.pages().length} (原 ${pagesBefore})`);
    console.log('  提示类元素:', JSON.stringify(toast));
    console.log('  菜单是否仍在:', await page.evaluate(() => !!document.querySelector('.next-overlay-wrapper.opened .next-menu')));
    if (added) console.log('  文本变化片段:', added.slice(0, 200));
  }

  try {
    await page.screenshot({ path: SHOT + '/export-after-click.png' });
    console.log('\n截图已存: ' + SHOT + '/export-after-click.png');
  } catch (e) {}

  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
