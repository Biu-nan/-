// 纳物侧（速卖通全托管后台）库存采集
// 实测地图（2026-09-29）：
//   外层门户 csp.aliexpress.com -> 补货入库 -> 库存管理（SPA 路由 /m_apps/ascp/aechoice.inventory_distribution_details_management）
//     -> iframe 内嵌 dchain-web.aliexpress.com/pages/aechoice/inventory_distribution_details_management
//   页面 4 个标签：库存分布概览 / 实时库存明细 / 占用库存明细 / 在途库存明细
//   导出：点「导出数据」弹出的是 Fusion 下拉菜单（不是 dialog），结构为
//     li.next-menu-group-label[title="品维度"] + 2 个 li.next-menu-item
//     li.next-menu-divider
//     li.next-menu-group-label[title="品仓维度"] + 2 个 li.next-menu-item   <- 目标：这一组里的第一个（所有数据）
//     选中即触发导出，无二次确认
//   登录：稳卖会把 loginName / password 预填在登录页，点「登录」即可；出现验证码一律中止
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 浏览器接入 ----------
async function connectStore(cdpPort, log) {
  // 新拉起的浏览器 CDP 端口未必立刻就绪，做指数退避重试
  let lastErr = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort);
      const ctx = browser.contexts()[0] || (await browser.newContext());
      log.info(`已接入店铺浏览器 CDP :${cdpPort}（第 ${attempt + 1} 次尝试）`);
      return { browser, ctx };
    } catch (e) {
      lastErr = e;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw new Error('connectOverCDP 多次重试失败: ' + (lastErr && lastErr.message ? lastErr.message.slice(0, 120) : String(lastErr)));
}

async function pageState(page) {
  return page.evaluate(() => {
    const visible = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const pw = Array.from(document.querySelectorAll('input[type=password]')).find(visible);
    return {
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      inputCount: document.querySelectorAll('input').length,
      hasPassword: !!pw,
      captcha: !!document.querySelector(
        '#nc_1_wrapper, .nc-container, .baxia-dialog, iframe[src*="punish"], iframe[src*="captcha"], [class*=slider]'
      ),
    };
  });
}

// 轮询直到满足条件（页面渲染有延迟，不能靠固定 sleep 判登录态）
async function waitFor(page, predicate, timeoutMs, stepMs) {
  const t0 = Date.now();
  let s = await pageState(page);
  while (Date.now() - t0 < (timeoutMs || 20000)) {
    if (predicate(s)) return s;
    await sleep(stepMs || 1500);
    s = await pageState(page);
  }
  return s;
}

// 是否停在登录页：以「有可见密码框」或「域名是 login.」为准
const isLoginPage = (s) =>
  s.hasPassword || /^https?:\/\/login\./i.test(s.href) || /\/login\b|signin/i.test(s.href);

// ---------- 登录保活 ----------
// 判定登录态的正确姿势：看目标系统（门户）会不会被踢回登录页，而不是直接访问登录页
async function ensureLoggedIn(page, cfg, log) {
  const lg = cfg.login;

  log.info('访问门户检查登录态: ' + lg.entryUrl);
  await page.goto(lg.entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  let s = await waitFor(page, (x) => x.hasPassword || x.inputCount > 0, 25000);
  log.info('门户落地状态: ' + JSON.stringify(s));

  if (!isLoginPage(s)) {
    log.info('已是登录态（门户未被踢回登录页）');
    return { ok: true, action: 'already' };
  }

  log.step('门户被踢回登录页，尝试用稳卖预填凭据登录');
  await page.goto(lg.url, { waitUntil: 'domcontentloaded', timeout: 90000 });

  s = await waitFor(page, (x) => x.hasPassword || x.captcha || x.inputCount > 0, 30000);
  if (s.captcha) return { ok: false, reason: '登录页直接出现验证码，已中止', captcha: true };

  // 等稳卖把凭据填进去
  let prefill = [];
  const tPrefill = Date.now();
  while (Date.now() - tPrefill < 15000) {
    prefill = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input')).map((i) => ({
        id: i.id, type: i.type, len: (i.value || '').length,
        visible: !!(i.offsetWidth || i.offsetHeight),
      }))
    );
    if (
      prefill.some((x) => x.type === 'text' && x.len > 0) &&
      prefill.some((x) => x.type === 'password' && x.len > 0)
    ) {
      break;
    }
    await sleep(1500);
  }
  log.info('登录页预填情况: ' + JSON.stringify(prefill));

  const hasCreds =
    prefill.some((x) => x.type === 'text' && x.len > 0) &&
    prefill.some((x) => x.type === 'password' && x.len > 0);
  if (!hasCreds) return { ok: false, reason: '登录页未预填凭据，需人工登录（不做自动登录）' };
  if (!lg.autoClickLogin) return { ok: false, reason: '未开启自动点击登录' };

  log.step('点击「登录」（使用稳卖预填凭据）');
  let clicked = false;
  for (const tryClick of [
    () => page.locator('button:visible', { hasText: /^登录$/ }).first().click({ timeout: 8000 }),
    () => page.getByRole('button', { name: '登录', exact: true }).click({ timeout: 8000 }),
    () => page.locator('.fm-button, .next-btn-primary, button[type=submit]').first().click({ timeout: 8000 }),
  ]) {
    try {
      await tryClick();
      clicked = true;
      break;
    } catch (e) {
      /* 换下一种 */
    }
  }
  if (!clicked) return { ok: false, reason: '未找到登录按钮' };

  const deadline = Date.now() + (lg.waitAfterClickMs || 45000);
  while (Date.now() < deadline) {
    await sleep(3000);
    s = await pageState(page);
    if (s.captcha) return { ok: false, reason: '出现验证码/风控，已中止（不做绕过）', captcha: true };
    if (!isLoginPage(s)) {
      log.info('登录成功 -> ' + s.href.slice(0, 110));
      await sleep(4000);
      // 回门户复验：真登录态应能停在门户，而不是又被踢回来
      await page.goto(lg.entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
      const v = await waitFor(page, (x) => x.hasPassword || x.inputCount > 0, 25000);
      if (isLoginPage(v)) return { ok: false, reason: '登录后回门户仍被踢回登录页' };
      log.info('门户复验通过');
      return { ok: true, action: 'clicked' };
    }
  }
  return { ok: false, reason: '点击登录后仍在登录页（可能账号需二次验证）' };
}

// ---------- 进入库存管理 -> 实时库存明细 ----------
// channelId 是店铺级参数：pageUrl 里写死别家的 channelId 会被 DChain 踢回独立登录墙
// （2026-09-29 实测：400370 用 416488 的 channelId=2443536 -> "Sign in" 页）
//
// SSO 预热：直接深链 dchain-web 缺少 partner SSO 上下文，会停在独立 Sign in 页；
// 必须先走 csp SPA 路由（内嵌 iframe -> basic_login_proxy autoLoginFast=true），
// 等 iframe 自动登录完成（src 变成真实库存页）后，再深链 dchain-web 跑导出。
async function waitForSsoReady(page, channelId, timeoutMs, log) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 30000)) {
    let ready = false;
    try {
      ready = await page.evaluate((cid) => {
        return Array.from(document.querySelectorAll('iframe')).some((f) => {
          const s = f.src || f.getAttribute('src') || '';
          return (
            /dchain-web\.aliexpress\.com\/pages\/aechoice\/inventory_distribution_details_management/.test(s) &&
            s.indexOf('channelId=' + cid) !== -1 &&
            s.indexOf('basic_login_proxy') === -1
          );
        });
      }, String(channelId));
    } catch (e) {
      /* 导航瞬间 evaluate 可能抛错，忽略继续轮询 */
    }
    if (ready) {
      log.info('DChain SSO 预热完成（iframe 已自动登录并指向真实库存页）');
      return true;
    }
    await sleep(2000);
  }
  return false;
}

async function openRealtimeTab(page, cfg, log, channelId) {
  const inv = cfg.inventory;
  let url = inv.pageUrl;
  if (/\{channelId\}/.test(url)) {
    if (!channelId) return { ok: false, reason: '无法确定该店铺的 channelId（门户 URL 未暴露且 channelIdMap 无配置）' };
    url = url.replace(/\{channelId\}/g, channelId);
    log.info(`库存页使用 channelId=${channelId}`);
  }

  // 1) SSO 预热：经 csp SPA 路由触发 DChain partner 自动登录
  if (inv.portalInventoryUrl) {
    if (!/\{channelId\}/.test(inv.portalInventoryUrl)) {
      log.warn('portalInventoryUrl 未包含 {channelId} 占位符，跳过预热');
    } else if (!channelId) {
      log.warn('无 channelId，跳过 SSO 预热');
    } else {
      const portalUrl = inv.portalInventoryUrl.replace(/\{channelId\}/g, channelId);
      log.info('SSO 预热：先走 csp SPA 路由 -> ' + portalUrl);
      try {
        await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
        const warmed = await waitForSsoReady(page, channelId, inv.ssoWarmupTimeoutMs, log);
        if (!warmed) log.warn('SSO 预热未在超时内确认，仍尝试直接深链 dchain-web');
      } catch (e) {
        log.warn('SSO 预热导航失败: ' + e.message.slice(0, 90));
      }
    }
  }

  // 2) 深链 dchain-web 跑导出（SSO 已建立，或沿用旧路径）
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

  const s = await waitFor(page, (x) => x.hasPassword || x.inputCount > 0, 25000);
  if (isLoginPage(s)) {
    const li = await ensureLoggedIn(page, cfg, log);
    if (!li.ok) return { ok: false, reason: '登录失败: ' + li.reason };
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  }
  await sleep(inv.pageReadyMs || 18000);

  const title = await page.title();
  if (!/库存/.test(title)) {
    return { ok: false, reason: `页面标题异常「${title}」，可能无权限或路由变更` };
  }

  let switched = false;
  for (const tryClick of [
    () => page.getByText(inv.tabName, { exact: true }).first().click({ timeout: 8000 }),
    () => page.locator(`text=${inv.tabName}`).first().click({ timeout: 8000 }),
  ]) {
    try {
      await tryClick();
      switched = true;
      break;
    } catch (e) {
      /* 换下一种 */
    }
  }
  if (switched) {
    log.info('已切换到「' + inv.tabName + '」');
    await sleep(15000);
  } else {
    log.warn('未点到「' + inv.tabName + '」标签，按默认标签继续');
  }

  const meta = await page.evaluate(() => {
    const m = (document.body.innerText || '').match(/共\s*([\d,]+)\s*[项条]/);
    return {
      totalText: m ? m[1] : null,
      headers: [
        ...new Set(
          Array.from(document.querySelectorAll('th')).map((t) => (t.innerText || '').trim()).filter(Boolean)
        ),
      ],
      rowCount: document.querySelectorAll('tbody tr').length,
    };
  });
  log.info('页面元信息: ' + JSON.stringify(meta));
  return { ok: true, meta, switched };
}

// ---------- 导出 ----------
async function clickByText(page, text, scopeSel) {
  const inScope = scopeSel ? `${scopeSel} ` : '';
  for (const tryClick of [
    () => page.locator(`${inScope}button:has-text("${text}")`).first().click({ timeout: 6000 }),
    () => page.getByText(text, { exact: true }).first().click({ timeout: 6000 }),
  ]) {
    try {
      await tryClick();
      return true;
    } catch (e) {
      /* 下一种 */
    }
  }
  return false;
}

// 把 Fusion 下拉菜单里的选项 dump 出来（诊断 + 兜底定位用）
async function dumpExportMenu(page) {
  return page.evaluate(() => {
    const menus = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .next-menu, [role=listbox].next-menu'));
    const menu = menus[menus.length - 1];
    if (!menu) return null;
    return Array.from(menu.querySelectorAll('li')).map((li, i) => ({
      i,
      cls: (li.className || '').toString().slice(0, 60),
      title: li.getAttribute('title'),
      text: (li.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 46),
    }));
  });
}

// 选中「品仓维度 -> 所有数据」：xpath 精确定位，失败则按序索引兜底
async function pickReplenishScope(page, cfg, log) {
  const dim = cfg.inventory.exportDimension;

  const xp =
    `//li[contains(@class,"next-menu-group-label") and normalize-space(@title)="${dim}"]` +
    `/following-sibling::*[1]//li[contains(@class,"next-menu-item")][1]`;
  try {
    const target = page.locator('xpath=' + xp).first();
    if ((await target.count()) > 0) {
      await target.click({ timeout: 8000 });
      log.info(`已选择「${dim} -> 所有数据」（xpath 精确定位）`);
      return { ok: true, strategy: 'xpath' };
    }
    log.warn('xpath 未命中菜单项');
  } catch (e) {
    log.warn('xpath 定位失败: ' + e.message.slice(0, 90));
  }

  // 兜底：菜单项按序为 [品维度-所有, 品维度-非零, 品仓维度-所有, 品仓维度-非零] -> 取 index 2
  try {
    const items = page.locator('.next-overlay-wrapper.opened .next-menu-item');
    const n = await items.count();
    if (n >= 3) {
      await items.nth(2).click({ timeout: 8000 });
      log.info('已按索引兜底选择第 3 个菜单项');
      return { ok: true, strategy: 'index' };
    }
    log.warn('菜单项数量异常: ' + n);
  } catch (e) {
    log.warn('索引兜底失败: ' + e.message.slice(0, 90));
  }
  return { ok: false, strategy: 'none' };
}

// 导出是异步任务：选完菜单项只代表「提交」，产物出现在消息中心（.s-file-item），
// 必须再点其中的「下载文件」才能取回；刚提交时文件可能还没生成好，所以要重试
async function fetchFromMessageCenter(page, cfg, log, dlRef) {
  const inv = cfg.inventory;
  const kw = inv.exportMessageKeyword || '实时库存数据';
  const deadline = Date.now() + (inv.downloadTimeoutMs || 300000);
  let attempt = 0;
  let lastReason = '消息中心未出现导出记录';
  while (Date.now() < deadline) {
    if (dlRef.value) return { ok: true };
    attempt++;
    try {
      const item = page.locator('.s-file-item', { hasText: kw }).first();
      if ((await item.count()) === 0) {
        lastReason = '消息中心暂无「' + kw + '」记录';
      } else {
        const time = await item
          .locator('.s-file-time')
          .first()
          .innerText()
          .catch(() => '');
        await item.locator('.operation a').first().click({ timeout: 8000 });
        log.info(`第 ${attempt} 次点击消息中心「下载文件」（该记录时间：${String(time).trim()}）`);
        lastReason = '已点下载但未收到文件';
      }
    } catch (e) {
      lastReason = '点击下载链接失败: ' + e.message.slice(0, 90);
      log.warn(lastReason);
    }
    const t = Date.now() + 25000;
    while (Date.now() < t && !dlRef.value) await sleep(2000);
  }
  return { ok: false, reason: '下载超时：' + lastReason };
}

async function exportInventory(page, cfg, log, rawDir) {
  const inv = cfg.inventory;

  if (!(await clickByText(page, inv.exportButton))) {
    return { ok: false, reason: '未找到「' + inv.exportButton + '」按钮' };
  }
  log.info('已点击「' + inv.exportButton + '」，等待下拉菜单');
  await sleep(inv.dialogWaitMs || 4000);

  const menu = await dumpExportMenu(page);
  log.info('导出菜单项: ' + JSON.stringify(menu));
  if (!menu || !menu.length) return { ok: false, reason: '导出菜单未出现' };

  // 先挂下载监听，再点选项（选项一点即触发导出）
  const dlRef = { value: null };
  const onDownload = async (d) => {
    try {
      const target = path.join(rawDir, d.suggestedFilename());
      await d.saveAs(target);
      dlRef.value = { file: target, size: fs.statSync(target).size };
      log.info(`下载完成 -> ${target} (${dlRef.value.size} bytes)`);
    } catch (e) {
      dlRef.value = { error: e.message.slice(0, 140) };
    }
  };
  page.on('download', onDownload);
  page.on('popup', (p) => log.info('导出触发新窗口: ' + p.url().slice(0, 90)));

  const picked = await pickReplenishScope(page, cfg, log);
  if (!picked.ok) {
    page.off('download', onDownload);
    return { ok: false, reason: '未能选中「' + inv.exportDimension + '」菜单项' };
  }

  // 菜单项一点即提交导出任务，接着去消息中心取文件
  const viaMsg = await fetchFromMessageCenter(page, cfg, log, dlRef);
  page.off('download', onDownload);

  if (dlRef.value && dlRef.value.file) {
    return { ok: true, ...dlRef.value, strategy: picked.strategy, via: 'message-center' };
  }
  if (dlRef.value && dlRef.value.error) {
    return { ok: false, reason: '保存下载失败: ' + dlRef.value.error };
  }
  return { ok: false, reason: viaMsg.reason || '未取到导出文件' };
}

// ---------- 降级：按页抓 DOM（仅品维度，不含分仓拆分） ----------
async function scrapeByDom(page, cfg, log) {
  const maxPages = (cfg.fallback && cfg.fallback.maxPages) || 25;
  const all = [];
  for (let p = 1; p <= maxPages; p++) {
    const rows = await page.evaluate(() => {
      const txt = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
      return Array.from(document.querySelectorAll('tbody tr')).map((tr) => ({
        行文本: Array.from(tr.querySelectorAll('td')).map(txt).join(' | '),
      }));
    });
    if (!rows.length) break;
    all.push(...rows.map((r) => ({ 页码: p, ...r })));
    log.info(`DOM 抓取第 ${p} 页，累计 ${all.length} 行`);
    try {
      const next = page.locator('button:has-text("下一页"), .next-pagination-next, [aria-label="下一页"]').first();
      if ((await next.count()) === 0 || (await next.isDisabled())) break;
      await next.click({ timeout: 6000 });
      await sleep(6000);
    } catch (e) {
      break;
    }
  }
  return all;
}

// ---------- 解析导出文件为品仓维度标准行 ----------
// 按实测导出文件的真实列名映射（2026-09-29 实测 50 列）
// 顺序即优先级，第一个命中的生效
const HEADER_MAP = [
  [/^货品ID$|货品ID/, '货品ID'],
  [/^货品编码$/, '货品编码'],
  [/^货品名称$|商品名称/, '商品名称'],
  [/^关联商品ID$/, '关联商品ID'],
  [/^关联SKUID$/, '关联SKUID'],
  [/^仓类型$/, '仓类型'],
  [/^仓Code$/, '仓Code'],
  [/^仓名称$|^仓库$/, '仓库'],
  [/^区域$/, '区域'],
  [/^货品经营状态$|货品状态/, '货品状态'],
  [/^备货模式$/, '备货模式'],
  [/^仓发天数$/, '仓发天数'],
  [/^周转天数$/, '周转天数'],
  [/^最近补货上架日期$/, '最近补货上架'],
  [/^最近销售出库日期$/, '最近销售出库'],
  [/^总库存件数$/, '总库存'],
  [/^在仓总库存件数$/, '在仓库存'],
  [/^在仓良品可售库存件数$/, '在仓可售库存'],
  [/^在仓不可售库存件数$/, '在仓不可售库存'],
  [/^已收货待上架件数$/, '已收货待上架'],
  [/^残品库存件数$/, '残品库存'],
  [/^在途总库存件数$/, '在途库存'],
  [/^总补货在途件数$/, '补货在途'],
  [/^销售在途件数$/, '销售在途'],
  [/^销售占用件数$/, '销售占用'],
  [/^总占用库存件数$/, '占用库存'],
  [/^可退仓件数$/, '可退仓库存'],
  [/^近7天销售出库件数$/, '近7天出库'],
  [/^近30天销售出库件数$/, '近30天出库'],
  [/^导出时间$/, '导出时间'],
];

function normalizeRow(raw, store) {
  const out = {};
  for (const key of Object.keys(raw)) {
    const k = String(key).replace(/\s+/g, '').trim();
    for (const [re, std] of HEADER_MAP) {
      if (!out[std] && re.test(k)) {
        out[std] = raw[key];
        break;
      }
    }
  }
  return {
    店铺: store.name,
    storeId: store.id,
    ...out,
    原始字段: raw,
  };
}

module.exports = {
  connectStore,
  ensureLoggedIn,
  openRealtimeTab,
  waitForSsoReady,
  exportInventory,
  scrapeByDom,
  normalizeRow,
  pageState,
  isLoginPage,
  sleep,
};
