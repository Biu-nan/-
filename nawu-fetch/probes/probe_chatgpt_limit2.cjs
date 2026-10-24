// 侦察 v2：长时间等待 + 穿透 shadow DOM / iframe，确认「长度上限」横幅的可检测特征
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const RAW = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONV = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/c/6aaac0ca-1bf4-83ec-aefd-d514390c9539';

// 深度遍历：document + 所有 shadowRoot + 所有 iframe
function deepScan() {
  const out = { texts: [], buttons: [], fullHit: [], nodes: 0 };
  const seen = new Set();
  const walk = (root, depth) => {
    if (!root || depth > 12) return;
    out.nodes++;
    let all;
    try { all = root.querySelectorAll('*'); } catch (e) { return; }
    for (const el of all) {
      if (seen.has(el)) continue;
      seen.add(el);
      const t = (el.childElementCount === 0 ? el.textContent || '' : el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/长度上限|开始新聊天|length limit|Start a new chat|new chat to continue|上限/i.test(t) && t.length < 260) {
        out.fullHit.push({
          tag: el.tagName, cls: (el.className || '').toString().slice(0, 140),
          testid: el.getAttribute('data-testid') || '', aria: el.getAttribute('aria-label') || '',
          role: el.getAttribute('role') || '', t: t.slice(0, 200),
        });
      }
      if (el.tagName === 'BUTTON' || el.tagName === 'A') {
        const label = ((el.innerText || '').replace(/\s+/g, ' ').trim() + '|' + (el.getAttribute('aria-label') || '')).trim();
        if (label.length > 1 && label !== '|') out.buttons.push({ label: label.slice(0, 100), cls: (el.className || '').toString().slice(0, 100), testid: el.getAttribute('data-testid') || '', disabled: !!el.disabled });
      }
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
      if (el.tagName === 'IFRAME') { try { if (el.contentDocument) walk(el.contentDocument, depth + 1); } catch (e) { /* cross-origin */ } }
    }
  };
  walk(document, 0);
  const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ');
  return {
    verified: true,
    url: location.href,
    hasFullText: /长度上限|length limit/i.test(bodyText),
    bodyTail: bodyText.slice(-400),
    fullHitCount: out.fullHit.length,
    fullHits: out.fullHit.slice(-20),
    buttons: out.buttons.slice(0, 40),
    nodes: out.nodes,
  };
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();
  await page.goto(CONV, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  const tries = [];
  for (let i = 1; i <= 5; i++) {
    await sleep(10000);
    const r = await page.evaluate(deepScan);
    tries.push({ waitSec: i * 10, hasFullText: r.hasFullText, hitCount: r.fullHitCount, tail: r.bodyTail.slice(-160) });
    if (r.hasFullText || r.fullHitCount) { tries[tries.length - 1].detail = r; break; }
  }
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, 'chatgpt_limit_recon2.json'), JSON.stringify(tries, null, 2));
  console.log(JSON.stringify(tries, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
