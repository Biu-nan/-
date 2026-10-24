// 深度只读诊断（2026-10-16）：判断本次提示词是否真正落库。
//  - 强制服务端重载 + 滚动到底，抓取对话最后若干条文本与是否含今日日期
//  - 探测多个后端会话接口路径，找可用者，读模型 slug / update_time / 末条消息
// 不写入、不清草稿、不发送。
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'chatgpt-config.json'), 'utf8'));
const CID = (cfg.conversationUrl.match(/\/c\/([0-9a-f-]+)/) || [])[1];

(async () => {
  const browser = await chromium.connectOverCDP(cfg.cdpUrl, { timeout: 30000 });
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();

  await page.goto(cfg.conversationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const sc = document.scrollingElement || document.body;
      sc.scrollTop = sc.scrollHeight;
    });
    await page.waitForTimeout(2500);
  }

  const dom = await page.evaluate(() => {
    const body = document.body.innerText || '';
    const tail = body.slice(-1200).replace(/\n{2,}/g, '\n');
    return {
      url: location.href,
      title: document.title,
      has1016: body.includes('2026-10-16'),
      has1015: body.includes('2026-10-15'),
      hasModelErr: /model not found|模型不可用|出现错误|出错了|无法加载|重试/i.test(body),
      tail,
    };
  });

  const api = await page.evaluate(async (cid) => {
    const paths = [
      '/backend-api/conversation/' + cid,
      '/backend-api/conversations/' + cid,
      '/backend-api/conversation/' + cid + '?include_visually_hidden_messages=true',
    ];
    const out = [];
    for (const p of paths) {
      try {
        const r = await fetch(p, { credentials: 'include' });
        let model = null, upd = null, n = 0, lastUser = null, lastAny = null;
        if (r.ok) {
          const j = await r.json().catch(() => null);
          if (j && j.mapping) {
            const msgs = Object.values(j.mapping).map((x) => x.message).filter(Boolean)
              .map((m) => ({ role: (m.author && m.author.role) || '?', ct: m.create_time || 0,
                text: (((m.content && m.content.parts) || []).join(' ') || '').slice(0, 100).replace(/\s+/g, ' ') }))
              .sort((a, b) => a.ct - b.ct);
            n = msgs.length; model = j.default_model_slug || null; upd = j.update_time || null;
            lastUser = [...msgs].reverse().find((m) => m.role === 'user') || null;
            lastAny = msgs[msgs.length - 1] || null;
          }
        }
        out.push({ path: p, status: r.status, model, updateTime: upd, msgCount: n, lastUser, lastAny });
      } catch (e) { out.push({ path: p, error: e.message }); }
    }
    return out;
  }, CID);

  console.log(JSON.stringify({ convId: CID, dom, api }, null, 2));
  await browser.close();
})().catch((e) => { console.error('DIAG_FAIL', e.message); process.exit(1); });
