// 找到「已发送」的那条用户消息（含提示词，且在 composer 之外），dump 其 HTML 看附件
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/c/6aaac0ca-1bf4-83ec-aefd-d514390c9539';

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = b.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url())) || (await ctx.newPage());
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await sleep(9000);
  for (let i = 0; i < 10; i++) { await page.keyboard.press('End').catch(() => {}); await page.evaluate(() => { const els = Array.from(document.querySelectorAll('div,main')).filter((e) => e.scrollHeight > e.clientHeight + 200).sort((a, z) => z.scrollHeight - a.scrollHeight)[0]; if (els) els.scrollTop = els.scrollHeight; window.scrollTo(0, document.body.scrollHeight); }); await sleep(1200); }

  const r = await page.evaluate(() => {
    const form = document.querySelector('form[data-chatgpt-composer]');
    const marker = '生成今天的采购表格';
    const els = Array.from(document.querySelectorAll('*')).filter((e) => (e.innerText || '').includes(marker) && (!form || !form.contains(e)));
    // 取最内层（叶子最少）
    const el = els.sort((a, c) => a.querySelectorAll('*').length - c.querySelectorAll('*').length)[0];
    if (!el) return { err: 'no sent msg' };
    let node = el;
    for (let i = 0; i < 8 && node.parentElement; i++) node = node.parentElement;
    const html = node.outerHTML || '';
    return {
      elsCount: els.length,
      nodeTag: node.tagName, nodeTestid: node.getAttribute('data-testid') || '', nodeRole: node.getAttribute('data-message-author-role') || '',
      hasXlsx: /xlsx/i.test(html),
      attachWords: (html.match(/attachment|附件|file/gi) || []).length,
      snippet: html.replace(/\s+/g, ' ').slice(0, 2000),
    };
  });
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'chatgpt_sentmsg.json'), JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ elsCount: r.elsCount, nodeTag: r.nodeTag, nodeTestid: r.nodeTestid, nodeRole: r.nodeRole, hasXlsx: r.hasXlsx, attachWords: r.attachWords }, null, 2));
  console.log('--- snippet ---');
  console.log(r.snippet || r.err);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
