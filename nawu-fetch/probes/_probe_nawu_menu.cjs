// 导出 CSP 左侧菜单树（name + path + link），一次拿到完整站点地图
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => /csp\.aliexpress\.com/.test(p.url())) || await ctx.newPage();
  await page.goto('https://csp.aliexpress.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);

  const tree = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.left-menu-container--YAipui2U li, [class*=left-menu-container] li'));
    const seen = new Set();
    const out = [];
    for (const n of nodes) {
      const name = n.getAttribute('name') || (n.innerText || '').replace(/\s+/g, ' ').trim().split(' ')[0];
      const path = n.getAttribute('path');
      const link = n.getAttribute('link');
      const lv = n.getAttribute('level');
      const key = (lv || '') + '|' + name + '|' + (path || '');
      if (seen.has(key) || !name) continue;
      seen.add(key);
      out.push({ lv, name: name.slice(0, 24), path, link });
    }
    // 同时把「补货入库」子树的完整 HTML 属性抓出来
    const root = document.querySelector('#Root-Home-stockandinbound');
    const subtree = root
      ? Array.from(root.querySelectorAll('li')).map((li) => ({
          name: li.getAttribute('name'), path: li.getAttribute('path'), link: li.getAttribute('link'),
        }))
      : null;
    return { count: out.length, all: out, replenishSubtree: subtree };
  });

  console.log('菜单节点总数:', tree.count);
  console.log('\n=== 补货入库 子树 ===');
  console.log(JSON.stringify(tree.replenishSubtree, null, 1));
  console.log('\n=== 全部菜单（含 path）===');
  tree.all.forEach((n) => console.log('  [L' + (n.lv || '?') + '] ' + (n.name || '') + '  ->  ' + (n.path || n.link || '')));

  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
