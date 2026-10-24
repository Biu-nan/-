// 判定消息是否真的发出：composer 里是否还留着草稿；对话里是否存在独立于 composer 的用户消息
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'https://chatgpt.com/g/g-p-6aa8b185e8208191866c4d85dc8d41cf/c/6aaac0ca-1bf4-83ec-aefd-d514390c9539';

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 60000 });
  const ctx = b.contexts()[0];
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url())) || (await ctx.newPage());
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await sleep(10000);
  for (let i = 0; i < 8; i++) { await page.keyboard.press('End').catch(() => {}); await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); }); await sleep(1000); }

  const r = await page.evaluate(() => {
    const composerForm = document.querySelector('form[data-chatgpt-composer]');
    const edits = composerForm ? Array.from(composerForm.querySelectorAll('div.ProseMirror')) : [];
    const composerText = edits.map((e) => (e.innerText || '').trim()).join(' | ');
    const chips = composerForm ? composerForm.querySelectorAll('[class~="group/composer-attachment"]').length : 0;
    // 独立于 composer 的、含提示词的元素（= 已发送的消息）
    const marker = '生成今天的采购表格';
    const all = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').includes(marker));
    const outside = all.filter((e) => !composerForm || !composerForm.contains(e));
    // 发送按钮
    const send = document.querySelector('#composer-submit-button, button[data-testid="send-button"]');
    const sendInfo = send ? { testid: send.getAttribute('data-testid'), aria: send.getAttribute('aria-label'), disabled: send.disabled } : null;
    // 是否有 stop（生成中）
    const stop = !!document.querySelector('button[data-testid="stop-button"]');
    return {
      composerTextLen: composerText.length,
      composerTextHead: composerText.slice(0, 120),
      composerChips: chips,
      sentMsgEls: outside.length,
      totalMarkerEls: all.length,
      sendInfo,
      stop,
    };
  });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
