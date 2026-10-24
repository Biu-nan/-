// 滚到对话底部再读最新内容，确认消息+附件+助手回复
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/c/6aaac0ca-1bf4-83ec-aefd-d514390c9539';

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = b.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url())) || (await ctx.newPage());
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await sleep(8000);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('End').catch(() => {});
    await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('div,main,section'));
      const sc = els.filter((e) => e.scrollHeight > e.clientHeight + 200).sort((a, z) => z.scrollHeight - a.scrollHeight)[0];
      if (sc) sc.scrollTop = sc.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    });
    await sleep(1500);
  }
  const r = await page.evaluate(() => {
    const body = document.body.innerText || '';
    const mine = ['nawu-1店-inventory-latest.xlsx', 'nawu-2店-inventory-latest.xlsx', 'dxm-warehouseProduct-latest.locked.xlsx', 'dxm-product-latest.xlsx', 'dxm-entryexit-latest.xlsx'];
    return {
      present: mine.map((n) => ({ n, found: body.includes(n) })),
      hasPrompt: /今天是 2026-09-29/.test(body),
      tail: body.replace(/\s+/g, ' ').slice(-1200),
      stop: !!document.querySelector('button[data-testid="stop-button"]'),
    };
  });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
