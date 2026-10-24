// 探针：检查速卖通登录页是否有预填账号/可直接点击登录（只读，不提交任何表单）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  console.log('当前页面数:', pages.length);

  for (const p of pages) {
    const url = p.url();
    if (!/login/i.test(url)) continue;
    console.log('\n=== 登录页:', url.slice(0, 120), '===');

    const dump = async (frame, tag) => {
      try {
        const r = await frame.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input')).map((i) => ({
            type: i.type, name: i.name, id: i.id, ph: i.placeholder,
            valLen: (i.value || '').length, readonly: i.readOnly, visible: !!(i.offsetWidth || i.offsetHeight),
          }));
          const btns = Array.from(document.querySelectorAll('button, [role=button], a.btn, .next-btn, input[type=submit]'))
            .map((b) => (b.innerText || b.value || '').trim()).filter((t) => t && t.length < 20);
          return {
            inputs,
            buttons: [...new Set(btns)].slice(0, 25),
            text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
          };
        }, { timeout: 15000 });
        console.log('--- ' + tag + ' ---');
        console.log('inputs:', JSON.stringify(r.inputs));
        console.log('buttons:', JSON.stringify(r.buttons));
        console.log('text:', r.text);
      } catch (e) {
        console.log('--- ' + tag + ' --- 读取失败: ' + e.message);
      }
    };

    await dump(p.mainFrame(), 'mainFrame');
    for (const f of p.frames()) {
      if (f === p.mainFrame()) continue;
      await dump(f, 'iframe: ' + (f.url() || '').slice(0, 90));
    }
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
