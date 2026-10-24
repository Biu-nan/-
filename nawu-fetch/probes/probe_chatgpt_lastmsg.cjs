// 定位含「今天是 2026-09-29」的消息元素，dump 其祖先 HTML，确认是否带附件 chip
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
  await sleep(8000);
  for (let i = 0; i < 10; i++) { await page.keyboard.press('End').catch(() => {}); await page.evaluate(() => { const els = Array.from(document.querySelectorAll('div,main')).filter((e) => e.scrollHeight > e.clientHeight + 200).sort((a, z) => z.scrollHeight - a.scrollHeight)[0]; if (els) els.scrollTop = els.scrollHeight; window.scrollTo(0, document.body.scrollHeight); }); await sleep(1200); }

  const r = await page.evaluate(() => {
    const leaf = Array.from(document.querySelectorAll('*')).find((e) => e.children.length === 0 && (e.innerText || '').includes('今天是 2026-09-29'));
    if (!leaf) return { err: 'prompt text not found' };
    let node = leaf;
    for (let i = 0; i < 6 && node.parentElement; i++) node = node.parentElement;
    const html = node.outerHTML || '';
    const nAttachment = (html.match(/attachment/gi) || []).length;
    const nFile = (html.match(/file/gi) || []).length;
    const imgs = Array.from(node.querySelectorAll('img')).length;
    const anchors = Array.from(node.querySelectorAll('a')).map((a) => (a.innerText || '').trim()).filter(Boolean).slice(0, 10);
    return { htmlLen: html.length, nAttachment, nFile, imgs, anchors, snippet: html.replace(/\s+/g, ' ').slice(0, 1500) };
  });
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'chatgpt_lastmsg.json'), JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
