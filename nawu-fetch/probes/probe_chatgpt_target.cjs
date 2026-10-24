// 侦察：CDP :9223 上的 ChatGPT 会话 —— 登录态 / 打开的标签 / 侧栏会话列表（找「纳物采购助手」）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const info = { tabs: [], chatgpt: null };
  for (const p of pages) info.tabs.push({ url: p.url(), title: await p.title().catch(() => '') });

  let page = pages.find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(8000);
  } else {
    await page.bringToFront().catch(() => {});
  }

  const dump = await page.evaluate(() => {
    const composer = document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]');
    const loginHint = !!document.querySelector('a[href*="auth/login"], button[data-testid="login-button"]');
    // 侧栏会话
    const links = Array.from(document.querySelectorAll('a[href^="/c/"], nav a[href*="/c/"]')).map((a) => ({ t: (a.innerText || '').replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') }));
    // 会话/项目名匹配
    const hit = links.filter((x) => /纳物|采购/.test(x.t));
    const sidebarText = (document.querySelector('nav, [class*=sidebar]') || {}).innerText || '';
    return {
      url: location.href,
      title: document.title,
      loggedInAs: (() => { const b = document.querySelector('button[data-testid="accounts-profile-button"], [aria-label*="account"]'); return b ? (b.innerText || '').slice(0, 40) : ''; })(),
      hasComposer: !!composer,
      loginHint,
      sidebarHasNawu: /纳物|采购/.test(sidebarText),
      convLinks: links.slice(0, 60),
      hit,
    };
  });
  info.chatgpt = dump;

  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'chatgpt_target_recon.json'), JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
