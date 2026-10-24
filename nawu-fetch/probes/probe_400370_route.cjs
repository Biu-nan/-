// 诊断 400370 的库存页真实路由：直接 dchain-web 深链会踢回 Sign in（缺 SSO）。
// 本探针尝试 csp SPA 路由（会内嵌 dchain iframe），并 dump 门户菜单 + iframe src。
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { WenmaiApi } = require('../lib/wenmai-api.cjs');
const inv = require('../lib/nawu-inventory.cjs');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const sleep = inv.sleep;

(async () => {
  const api = new WenmaiApi(CFG.wenmaiApi, CFG.apiMinIntervalMs);
  const storeId = 400370;
  const opened = await api.openEnv(storeId, 'default');
  console.log('openEnv', opened.pid, opened.cdpPort);
  const { ctx } = await inv.connectStore(opened.cdpPort, { info: (...a) => console.log('[info]', ...a) });
  const page = await ctx.newPage();

  // 登录态
  const lg = await inv.ensureLoggedIn(page, CFG, { info: (...a) => console.log('[info]', ...a) });
  console.log('login', JSON.stringify(lg));

  const channelId = (page.url().match(/[?&]channelId=(\d+)/) || [])[1] || CFG.channelIdMap[storeId] || '?';
  console.log('channelId =', channelId);

  // 1) 门户首页菜单 dump（找 补货入库 / 库存管理 入口）
  await page.goto(CFG.login.entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);
  const menu = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a, [role=menuitem], [class*=menu-item], button'))
      .map((e) => ({ t: (e.innerText || e.getAttribute('title') || '').replace(/\s+/g, ' ').trim(), href: e.getAttribute('href') || '' }))
      .filter((x) => x.t && /补货|入库|库存|管理|aechoice|inventory|供应链/i.test(x.t));
    return { url: location.href, title: document.title, links: links.slice(0, 40) };
  });
  console.log('PORTAL MENU:', JSON.stringify(menu, null, 2));

  // 2) 尝试 csp SPA 路由（会内嵌 dchain iframe）
  const spa = `https://csp.aliexpress.com/m_apps/ascp/aechoice.inventory_distribution_details_management?channelId=${channelId}`;
  await page.goto(spa, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(15000);
  const spaState = await page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll('iframe')).map((f) => f.src || f.getAttribute('src'));
    return {
      url: location.href,
      title: document.title,
      iframes: frames,
      hasNextMenu: !!document.querySelector('.next-menu'),
      bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
    };
  });
  console.log('SPA ROUTE STATE:', JSON.stringify(spaState, null, 2));

  // 3) 在 SPA 路由下，检查是否出现 导出数据 按钮 / 实时库存明细 标签（可能位于 iframe 内）
  const probeInFrames = await page.evaluate(() => {
    function walk(win, depth) {
      const out = { depth, url: win.location.href, title: win.document.title,
        hasExport: false, hasRealtime: false, hasFileItem: false, iframeSrcs: [] };
      try {
        out.hasExport = !!Array.from(win.document.querySelectorAll('*')).find((e) => /导出数据|导出/.test(e.innerText || ''));
        out.hasRealtime = !!Array.from(win.document.querySelectorAll('*')).find((e) => /实时库存明细/.test(e.innerText || ''));
        out.hasFileItem = !!win.document.querySelector('.s-file-item');
        Array.from(win.document.querySelectorAll('iframe')).forEach((f) => out.iframeSrcs.push(f.src || f.getAttribute('src')));
      } catch (e) { out.err = String(e).slice(0, 80); }
      const kids = [];
      try {
        Array.from(win.frames).forEach((fw) => kids.push(walk(fw, depth + 1)));
      } catch (e) {}
      out.frames = kids;
      return out;
    }
    return walk(window, 0);
  });
  console.log('FRAME WALK:', JSON.stringify(probeInFrames, null, 2));

  await api.closeEnv(storeId);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
