// 只读：导出可用模型 slug 与项目(gizmo)默认模型，用于确定 gpt-6-thinking 的替代。
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'chatgpt-config.json'), 'utf8'));
const GIZMO = 'g-p-6aa8b185e8208191866c4d85dc8d41cf';

(async () => {
  const browser = await chromium.connectOverCDP(cfg.cdpUrl, { timeout: 30000 });
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  const saved = {};
  page.on('response', async (r) => {
    const u = r.url();
    if (!/\/backend-api\//.test(u)) return;
    const ct = r.headers()['content-type'] || '';
    if (!/json/.test(ct)) return;
    try {
      const t = await r.text();
      if (/\/backend-api\/models/.test(u)) saved.models = t;
      if (/\/backend-api\/gizmos\//.test(u)) saved.gizmo = t;
      if (/\/backend-api\/settings\/user/.test(u)) saved.settings = t;
    } catch (e) {}
  });
  await page.goto(cfg.conversationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);

  const out = { models: null, projectModel: null, notes: [] };
  try {
    const m = JSON.parse(saved.models || '{}');
    const arr = m.models || m.data || [];
    out.models = arr.map((x) => ({ slug: x.slug, title: x.title, max_tokens: x.max_tokens, enabled: x.enabled })).filter((x) => x.slug);
  } catch (e) { out.notes.push('models parse fail: ' + e.message); }

  try {
    const g = JSON.parse(saved.gizmo || '{}');
    const s = JSON.stringify(g);
    const mIdx = s.indexOf('gpt-6-thinking');
    out.projectGizmoHasGpt6 = mIdx >= 0;
    // 抓取 gizmo 中出现的 model slug 片段
    const slugs = [...new Set((s.match(/gpt-[0-9a-z.\-]+/g) || []))];
    out.projectGizmoSlugs = slugs.slice(0, 20);
  } catch (e) { out.notes.push('gizmo parse fail: ' + e.message); }

  try {
    const u = JSON.parse(saved.settings || '{}');
    const s = JSON.stringify(u);
    out.settingsSlugs = [...new Set((s.match(/gpt-[0-9a-z.\-]+/g) || []))].slice(0, 20);
  } catch (e) {}

  console.log(JSON.stringify(out, null, 2));
  await page.close();
  await browser.close();
})().catch((e) => { console.error('DUMP_FAIL', e.message); process.exit(1); });
