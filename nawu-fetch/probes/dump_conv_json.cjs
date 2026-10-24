// 只读：把页面加载对话时的原始 JSON 落盘并解析，直接在载荷里找今日提示词。
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'chatgpt-config.json'), 'utf8'));
const CID = (cfg.conversationUrl.match(/\/c\/([0-9a-f-]+)/) || [])[1];

(async () => {
  const browser = await chromium.connectOverCDP(cfg.cdpUrl, { timeout: 30000 });
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  const hits = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (!/\/backend-api\//.test(u)) return;
    if (!/conversation/.test(u)) return;
    let t = null; try { t = await r.text(); } catch (e) { return; }
    if (t && t.includes(CID)) hits.push({ url: u, status: r.status(), body: t });
  });
  await page.goto(cfg.conversationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(15000);

  const out = { cid: CID, hitCount: hits.length, files: [] };
  hits.forEach((h, i) => {
    const fn = path.join(__dirname, '..', '.tmp', 'conv_raw_' + i + '.json');
    fs.writeFileSync(fn, h.body);
    let keys = [];
    try { keys = Object.keys(JSON.parse(h.body)); } catch (e) {}
    out.files.push({ i, url: h.url.replace(/\?.*/, ''), status: h.status, len: h.body.length, keys, hasDate1016: h.body.includes('2026-10-16'), hasPrompt: h.body.includes('今天是 2026-10-16') });
  });
  console.log(JSON.stringify(out, null, 2));
  await page.close(); await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
