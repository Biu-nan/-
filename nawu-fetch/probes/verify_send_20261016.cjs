// 只读核验（2026-10-16 增强版）：确认本次提示词是否「真正落库」（服务端权威），
// 而非发送器乐观渲染假象。
//   1) 强制 page.goto(conversationUrl) 从服务端重新拉取对话（消除乐观渲染）
//   2) 直接 fetch 后端会话 JSON（/backend-api/conversation/<id>）读消息列表
// 不写入、不清草稿、不发送。
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'chatgpt-config.json'), 'utf8'));
const CID = (cfg.conversationUrl.match(/\/c\/([0-9a-f-]+)/) || [])[1];
const PROBE_DATE = process.env.PROBE_DATE || new Date().toLocaleDateString('sv-SE');
const PHRASE = '今天是 ' + PROBE_DATE;

(async () => {
  const browser = await chromium.connectOverCDP(cfg.cdpUrl, { timeout: 30000 });
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();

  // 1) 服务端重载
  await page.goto(cfg.conversationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);

  const dom = await page.evaluate((phrase) => {
    const body = document.body.innerText || '';
    const idx = body.indexOf(phrase);
    return {
      url: location.href,
      title: document.title,
      promptsFoundInBody: idx >= 0,
      snippet: idx >= 0 ? body.slice(idx, idx + 120).replace(/\s+/g, ' ') : null,
      bodyHasDate: body.includes('2026-10-16'),
    };
  }, PHRASE);

  // 2) 后端权威载荷
  let backend = { ok: false };
  try {
    backend = await page.evaluate(async (cid) => {
      const r = await fetch('/backend-api/conversation/' + cid, { credentials: 'include' });
      if (!r.ok) return { ok: false, status: r.status };
      const j = await r.json();
      const map = j.mapping || {};
      const msgs = Object.values(map)
        .map((n) => n.message)
        .filter(Boolean)
        .map((m) => ({
          role: (m.author && m.author.role) || '?',
          ct: m.create_time,
          text: ((m.content && m.content.parts || []).join(' ') || '').slice(0, 140).replace(/\s+/g, ' '),
        }))
        .sort((a, b) => (a.ct || 0) - (b.ct || 0));
      const hits = msgs.filter((m) => m.text.includes('今天是 ' + (new Date()).toLocaleDateString('sv-SE')));
      return {
        ok: true,
        status: r.status,
        model: j.default_model_slug || null,
        updateTime: j.update_time || null,
        msgCount: msgs.length,
        lastUser: [...msgs].reverse().find((m) => m.role === 'user') || null,
        hitCount: hits.length,
        hits,
      };
    }, CID);
  } catch (e) {
    backend = { ok: false, error: e.message };
  }

  console.log(JSON.stringify({ probeDate: PROBE_DATE, convId: CID, dom, backend }, null, 2));
  await browser.close(); // connectOverCDP: 仅断开，不关闭 Chrome
})().catch((e) => { console.error('PROBE_FAIL', e.message); process.exit(1); });
