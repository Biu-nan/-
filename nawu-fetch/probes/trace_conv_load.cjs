// 权威核验（2026-10-16）：抓取页面自身加载对话时的后端响应，
// 读会话 update_time / default_model_slug / 末条消息（页面自带 Authorization，最可信）。
// 只读：仅打开对话页并监听响应，不写入、不清草稿、不发送。
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'chatgpt-config.json'), 'utf8'));
const CID = (cfg.conversationUrl.match(/\/c\/([0-9a-f-]+)/) || [])[1];

(async () => {
  const browser = await chromium.connectOverCDP(cfg.cdpUrl, { timeout: 30000 });
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  const bodies = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (!/\/backend-api\//.test(u)) return;
    const ct = (r.headers()['content-type'] || '');
    if (!/json|event-stream/.test(ct)) return;
    let t = null;
    try { t = await r.text(); } catch (e) { return; }
    if (t && t.length < 6_000_000) bodies.push({ url: u, status: r.status(), body: t });
  });

  await page.goto(cfg.conversationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(15000);

  // 找到含本对话 id 的会话数据
  let found = null;
  for (const b of bodies) {
    if (b.body.includes(CID) && (b.body.includes('"mapping"') || b.body.includes('update_time') || b.body.includes('default_model_slug'))) {
      try { const j = JSON.parse(b.body); if (j && (j.mapping || j.update_time)) { found = { url: b.url, j }; break; } } catch (e) {}
    }
  }

  let summary = { cid: CID, capturedCount: bodies.length, capturedUrls: bodies.map((b) => b.url.replace(/\?.*/, '') + ' [' + b.status + ']').slice(0, 25) };
  if (found) {
    const j = found.j;
    const msgs = j.mapping ? Object.values(j.mapping).map((x) => x.message).filter(Boolean)
      .map((m) => ({ role: (m.author && m.author.role) || '?', ct: m.create_time || 0,
        text: (((m.content && m.content.parts) || []).join(' ') || '').slice(0, 120).replace(/\s+/g, ' ') }))
      .sort((a, b) => a.ct - b.ct) : [];
    const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);
    summary.convUrl = found.url;
    summary.default_model_slug = j.default_model_slug || null;
    summary.update_time = iso(j.update_time);
    summary.msgCount = msgs.length;
    summary.last6 = msgs.slice(-6).map((m) => ({ role: m.role, t: iso(m.ct), text: m.text }));
    summary.has1016 = JSON.stringify(msgs).includes('2026-10-16') || JSON.stringify(j).includes('2026-10-16');
  } else {
    summary.note = '未捕获到含本对话 id 的会话 JSON';
  }
  console.log(JSON.stringify(summary, null, 2));
  await page.close();
  await browser.close();
})().catch((e) => { console.error('TRACE_FAIL', e.message); process.exit(1); });
