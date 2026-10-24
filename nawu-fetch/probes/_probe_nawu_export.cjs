// 验证「自定义导出字段」与「导出数据」的真实行为（是否可下文件 / 弹窗选项 / 异步任务）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const fs = require('fs');
const PORT = process.argv[2] || '14767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  await page.goto('https://dchain-web.aliexpress.com/pages/aechoice/inventory_distribution_details_management?channelId=2443536',
    { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(18000);
  try { await page.getByText('实时库存明细', { exact: true }).first().click({ timeout: 8000 }); } catch (e) {}
  await sleep(15000);

  const popupDump = () => page.evaluate(() => {
    const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const boxes = Array.from(document.querySelectorAll('[role=dialog],[class*=dialog],[class*=Dialog],[class*=modal],[class*=Modal],[class*=popup],[class*=drawer]'))
      .filter(vis).map(txt).filter(Boolean).slice(0, 4);
    const checks = Array.from(document.querySelectorAll('[role=dialog] label, [class*=dialog] label, [class*=modal] label'))
      .filter(vis).map(txt).filter(Boolean).slice(0, 60);
    const btns = [...new Set(Array.from(document.querySelectorAll('[role=dialog] button, [class*=dialog] button, [class*=modal] button'))
      .filter(vis).map(txt).filter(Boolean))].slice(0, 12);
    return { boxes, checks, btns };
  });

  console.log('=== 1. 点「自定义导出字段」 ===');
  try {
    await page.getByText('自定义导出字段', { exact: true }).first().click({ timeout: 8000 });
    await sleep(5000);
    console.log(JSON.stringify(await popupDump(), null, 1));
  } catch (e) { console.log('失败: ' + e.message.slice(0, 80)); }

  console.log('\n=== 2. 点「导出数据」并监听下载 ===');
  let dl = null;
  page.on('download', async (d) => {
    dl = { name: d.suggestedFilename(), url: d.url().slice(0, 120) };
    try {
      const p = 'F:/yikuaborder-deploy/_tmp_export_' + Date.now() + '_' + d.suggestedFilename();
      await d.saveAs(p);
      dl.savedTo = p;
      dl.size = fs.statSync(p).size;
    } catch (e) { dl.saveErr = e.message.slice(0, 80); }
  });
  try {
    await page.getByText('导出数据', { exact: true }).first().click({ timeout: 8000 });
    await sleep(12000);
  } catch (e) { console.log('点击导出失败: ' + e.message.slice(0, 80)); }

  console.log('下载事件:', JSON.stringify(dl));
  const after = await page.evaluate(() => ({
    dialogs: Array.from(document.querySelectorAll('[role=dialog],[class*=dialog],[class*=toast],[class*=message]'))
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6),
    tail: (document.body.innerText || '').replace(/\s+/g, ' ').slice(-400),
  }));
  console.log('弹窗/提示:', JSON.stringify(after, null, 1));

  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
