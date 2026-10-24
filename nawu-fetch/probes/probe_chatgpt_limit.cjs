// 侦察：① 目标对话是否出现「长度上限」横幅（选择器/文本/按钮）；② 项目页的新建对话入口
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONV = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/c/6aaac0ca-1bf4-83ec-aefd-d514390c9539';
const PROJECT = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/project';

const collect = () => {
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
  // 找含「长度上限」或「开始新聊天」的元素及其祖先，定位稳定选择器
  const hits = [];
  qa('div,section,aside,p,span,button,a').forEach((el) => {
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 200) return;
    if (/长度上限|开始新聊天|length limit|Start a new chat|new chat to continue/i.test(t)) {
      hits.push({
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        cls: (el.className || '').toString().slice(0, 120),
        testid: el.getAttribute('data-testid') || '',
        aria: el.getAttribute('aria-label') || '',
        href: el.getAttribute('href') || '',
        t: t.slice(0, 120),
      });
    }
  });
  return {
    url: location.href,
    title: document.title,
    hitCount: hits.length,
    hits: hits.slice(0, 25),
    hasFullText: /长度上限|length limit/i.test(txt),
    hasNewChatBtn: qa('button,a').some((b) => /开始新聊天|Start a new chat/i.test((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || ''))),
    composerVisible: qa('div.ProseMirror[contenteditable="true"]').some((e) => e.getBoundingClientRect().width > 0),
  };
};

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = browser.contexts()[0];
  const out = {};

  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();

  await page.goto(CONV, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await sleep(12000);
  out.conversation = await page.evaluate(collect);

  await page.goto(PROJECT, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);
  out.projectPage = await page.evaluate(() => {
    const qa = (s) => Array.from(document.querySelectorAll(s));
    return {
      url: location.href,
      title: document.title,
      composerVisible: qa('div.ProseMirror[contenteditable="true"]').some((e) => e.getBoundingClientRect().width > 0),
      contentEditables: qa('[contenteditable="true"]').map((e) => ({ cls: (e.className || '').toString().slice(0, 60), w: Math.round(e.getBoundingClientRect().width) })).slice(0, 8),
      fileInputs: qa('input[type=file]').map((i) => ({ accept: i.getAttribute('accept'), hidden: i.offsetParent === null })),
      buttons: qa('button,a').map((b) => ((b.innerText || '').replace(/\s+/g, ' ').trim() + '|' + (b.getAttribute('aria-label') || '') + '|' + (b.getAttribute('href') || ''))).filter((s) => s.length > 2).slice(0, 60),
    };
  });

  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'chatgpt_limit_recon.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
