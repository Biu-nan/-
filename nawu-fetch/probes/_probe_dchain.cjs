// 直接进 dchain-web 供应链系统，导出菜单树 / 表头 / 导出按钮
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => /dchain-web|csp\.aliexpress/.test(p.url())) || await ctx.newPage();

  const entry = 'https://dchain-web.aliexpress.com/pages/aechoice/purchase_order_list_aechoice?channelId=2443536';
  console.log('导航到:', entry);
  await page.goto(entry, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(18000);

  const dump = async (frame, tag) => {
    try {
      const r = await frame.evaluate(() => {
        const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
        const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
        const men = [...new Set(Array.from(document.querySelectorAll('li,a,[role=menuitem],[class*=menu] li'))
          .filter(vis).map(txt).filter((t) => t && t.length < 22))].slice(0, 60);
        const ths = [...new Set(Array.from(document.querySelectorAll('th'))
          .filter(vis).map(txt).filter((t) => t && t.length < 30))].slice(0, 50);
        const tabs = [...new Set(Array.from(document.querySelectorAll('[role=tab],[class*=tab-item],[class*=Tab]'))
          .filter(vis).map(txt).filter((t) => t && t.length < 22))].slice(0, 40);
        const btns = [...new Set(Array.from(document.querySelectorAll('button,[role=button],a[class*=btn],[class*=button]'))
          .filter(vis).map(txt).filter((t) => t && t.length < 16))].slice(0, 40);
        const rows = document.querySelectorAll('tbody tr,[class*=table-row],[class*=TableRow],[class*=vxe-body--row]').length;
        const stockLinks = [...new Set(Array.from(document.querySelectorAll('a[href],[path],[data-url]'))
          .map((e) => (e.getAttribute('href') || e.getAttribute('path') || e.getAttribute('data-url') || ''))
          .filter((h) => /stock|inventory|realtime|kuCun|inbound|ascm/i.test(h)))].slice(0, 30);
        return {
          href: location.href, title: document.title,
          menu: men, headers: ths, tabs, buttons: btns, rowCount: rows, stockishLinks: stockLinks,
          head: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1000),
        };
      }, { timeout: 20000 });
      console.log('\n===== ' + tag + ' =====');
      console.log('URL :', r.href.slice(0, 150));
      console.log('标题:', r.title);
      console.log('菜单:', JSON.stringify(r.menu));
      console.log('标签页:', JSON.stringify(r.tabs));
      console.log('表头:', JSON.stringify(r.headers));
      console.log('按钮:', JSON.stringify(r.buttons));
      console.log('行数:', r.rowCount);
      console.log('相关链接:', JSON.stringify(r.stockishLinks));
      console.log('正文:', r.head);
    } catch (e) {
      console.log('--- ' + tag + ' 读取失败: ' + e.message);
    }
  };

  await dump(page.mainFrame(), 'mainFrame');
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    await dump(f, 'iframe: ' + (f.url() || '').slice(0, 100));
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
