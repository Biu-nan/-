// 只读核验（新对话）：读 cfg.conversationUrl 对应会话的服务端 JSON，
// 输出 update_time / messages / 是否含今日提示词。不写入、不清草稿、不发送。
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'chatgpt-config.json'), 'utf8'));
const CID = (cfg.conversationUrl.match(/\/c\/([0-9a-f-]+)/) || [])[1];

(async () => {
  const browser = await chromium.connectOverCDP(cfg.cdpUrl, { timeout: 30000 });
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  let conv = null;
  page.on('response', async (r) => {
    const u = r.url();
    if (!/\/backend-api\/conversations\/[0-9a-f-]+$/.test(u.split('?')[0])) return;
    if (!u.includes(CID)) return;
    try { const j = await r.json(); if (j && j.messages) conv = j; } catch (e) {}
  });
  await page.goto(cfg.conversationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(15000);

  const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);
  let out = { cid: CID, got: !!conv };
  if (conv) {
    const msgs = (conv.messages || []).map((m) => ({
      role: (m.author && m.author.role) || '?',
      ct: m.create_time || 0,
      model: (m.metadata && m.metadata.model_slug) || null,
      text: (((m.content && m.content.parts) || []).join(' ') || '').slice(0, 140).replace(/\s+/g, ' '),
    })).sort((a, b) => a.ct - b.ct);
    out.title = conv.title;
    out.update_time = iso(conv.update_time);
    out.default_model_slug = conv.default_model_slug;
    out.msgCount = msgs.length;
    out.hasTodayPrompt = msgs.some((m) => m.text.includes('今天是 2026-10-16'));
    out.last4 = msgs.slice(-4).map((m) => ({ role: m.role, t: iso(m.ct), model: m.model, text: m.text }));
  }
  console.log(JSON.stringify(out, null, 2));
  await page.close(); await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
