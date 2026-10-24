// 侦察：打开「纳物采购助手」对话，确认 composer / 文件上传 / 发送按钮 / 消息列表选择器
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
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await sleep(25000);

  const dump = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => Array.from(document.querySelectorAll(s));
    return {
      url: location.href,
      title: document.title,
      bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
      contentEditables: qa('[contenteditable="true"], [contenteditable=""]').map((e) => ({ tag: e.tagName, cls: (e.className || '').toString().slice(0, 60), aria: e.getAttribute('aria-label') || '' })).slice(0, 8),
      textareas: qa('textarea').map((t) => ({ id: t.id, ph: t.getAttribute('placeholder') || '', testid: t.getAttribute('data-testid') || '' })).slice(0, 8),
      composer: !!q('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"], .ProseMirror'),
      fileInputs: qa('input[type=file]').map((i) => ({ accept: i.getAttribute('accept'), multiple: i.multiple, hidden: i.hidden || i.offsetParent === null })),
      sendBtn: !!q('[data-testid="send-button"], #composer-submit-button, button[aria-label*="Send"]'),
      attachBtn: qa('button').map((b) => b.getAttribute('aria-label') || b.getAttribute('data-testid') || '').filter((t) => /attach|upload|plus|file|添加|附件/i.test(t)).slice(0, 8),
      msgCount: qa('[data-message-author-role]').length,
      lastMsgs: qa('[data-message-author-role]').slice(-4).map((m) => ({ role: m.getAttribute('data-message-author-role'), t: (m.innerText || '').replace(/\s+/g, ' ').slice(0, 120) })),
      projectBadge: (q('[class*=project], a[href*="/g/g-p-"]') || {}).innerText || '',
    };
  });
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'chatgpt_conv_recon.json'), JSON.stringify(dump, null, 2));
  console.log(JSON.stringify(dump, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
