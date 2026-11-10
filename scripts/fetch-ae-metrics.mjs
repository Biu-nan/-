// S2 速卖通全托管后台抓取器（只读）
//
// 方式：经稳卖 openEnv 拿 CDP，旁听页面自身发出的 mtop 请求响应。
//      不自己构造 mtop 请求、不自己算签名 —— 让页面自己去要数据，我们只抄。
//
// 安全：
//   - 只导航页面 + 读取响应，不点击任何提交按钮
//   - 抓完按需 closeEnv（--keep-open 可保留环境）
//   - 绝不调 browser.close()（会关掉浏览器）
//
// 用法：
//   node scripts/fetch-ae-metrics.mjs [envId] [--keep-open] [--dry-run]
//   默认 envId=400370（纳物-箱包全托1店）

import { WenmaiApi } from '../nawu-fetch/lib/wenmai-api.cjs';
import { chromium } from 'playwright-core';
import { appendFacts, saveRaw, localDate } from './metrics-store.mjs';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const STORE_ID = Number(argv.find((a) => /^\d+$/.test(a)) || 400370);
const DRY = flags.has('--dry-run');
const KEEP_OPEN = flags.has('--keep-open');
const CHANNEL = process.env.AE_CHANNEL_ID || channelFor(STORE_ID);
const SOURCE = 'aliexpress';

// 稳卖 envId -> 全托管 channelId（来自 nawu-fetch/config.json，其余需实测补充）
function channelFor(id) {
  const m = { 416488: '2443536', 400370: '2358891' };
  return m[id] || '';
}

const URLS = {
  sales: `https://csp.aliexpress.com/m_apps/aechoice-Sales-statistics/sub-sales-aeChoice?channelId=${CHANNEL}`,
  fund: `https://csp.aliexpress.com/m_apps/fund/onestop?channelId=${CHANNEL}`,
  store: `https://csp.aliexpress.com/m_apps/one-stop-service-sycm/store-overview?channelId=${CHANNEL}`,
};

const API = {
  shopSales: 'mtop.global.merchant.shop.sales.summary',
  itemSummary: 'mtop.global.merchant.sales.summary',
  itemQuery: 'mtop.global.merchant.sales.query',
  fundOverview: 'mtop.ae.merchant.fund.accounting.queryfundoverview',
  delayPlan: 'mtop.aliexpress.seller.data.delay.plan',
  dps: 'mtop.aliexpress.dps.query',
};

const log = (...a) => console.log('[ae]', ...a);

// 金额单位是「分」，必须显式转元 —— 历史上这是 100 倍误差的高发点
const centToYuan = (c) => (typeof c === 'number' ? Math.round(c) / 100 : null);

async function collect(page, url, wanted, waitMs = 12000) {
  const captured = new Map();
  const onResp = async (res) => {
    const m = res.url().match(/\/h5\/([^/]+)\/[\d.]+\//);
    if (!m || !wanted.includes(m[1])) return;
    try {
      const j = await res.json();
      if (j?.data !== undefined) captured.set(m[1], j);
    } catch {}
  };
  page.on('response', onResp);
  try {
    // 若已停在目标页，SPA 不会重新发请求 —— 必须 reload 才能触发数据接口
    const sameBase = url.split('?')[0];
    if (page.url().split('?')[0] === sameBase) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
  } catch (e) {
    log('goto 警告:', e.message.slice(0, 70));
  }
  // 轮询等待：先等全部目标到齐，最多等 waitMs
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(800);
    if (wanted.every((a) => captured.has(a))) break;
  }
  page.off('response', onResp);
  return captured;
}

// DOM 兜底提取：某些 mtop 接口只在特定交互后才请求，抓不到时从页面文本取。
// 只在接口缺失时使用，并在 meta 标注 extractedBy='dom' 保持透明。
async function scrapeSalesFilters(page) {
  return page.evaluate(() => {
    const t = (document.body.innerText || '').replace(/\s+/g, ' ');
    const pick = (label) => {
      const m = t.match(new RegExp(label + '\\s*[（(](\\d+)[）)]'));
      return m ? Number(m[1]) : null;
    };
    return {
      all: pick('全部'),
      outOfStock: pick('已断货'),
      outOfSize: pick('已断码'),
      soldOutAlert: pick('售罄预警'),
      stockUpRecommend: pick('建议备货'),
      unmarketable: pick('滞销预警'),
    };
  });
}

async function scrapeStoreOverview(page) {
  // 先等核心指标区块渲染完整（这页是异步三跳加载，早抓会拿到 1/1/0 这种骨架值）
  await page.waitForFunction(
    () => {
      const t = (document.body.innerText || '').replace(/\s+/g, ' ');
      const i = t.indexOf('核心指标');
      if (i < 0) return false;
      const seg = t.slice(i, i + 300);
      return /浏览量/.test(seg) && /动销商品数/.test(seg) && /访客数/.test(seg);
    },
    { timeout: 25000, polling: 500 },
  ).catch(() => {});

  return page.evaluate(() => {
    const t = (document.body.innerText || '').replace(/\s+/g, ' ');
    const anchor = t.indexOf('核心指标');
    if (anchor < 0) return null;
    // 截到「详细模式 / 店铺诊断」为止，避免把国家排行里的同名列混进来
    let end = t.length;
    for (const stop of ['详细模式', '店铺诊断', '统计周期']) {
      const k = t.indexOf(stop, anchor);
      if (k > anchor) end = Math.min(end, k);
    }
    const scope = t.slice(anchor, end > anchor ? end : anchor + 400);
    const num = (label) => {
      const m = scope.match(new RegExp(label + '\\s*([\\d,]+(?:\\.\\d+)?)'));
      if (!m) return null;
      return Number(m[1].replace(/,/g, ''));
    };
    return {
      rawScope: scope.slice(0, 300),
      pv: num('浏览量'),
      uv: num('访客数'),
      buyers: num('支付买家数'),
      items: num('支付件数'),
      convRate: num('支付转化率'),
      activeSkus: num('动销商品数'),
    };
  });
}

// 平台日切窗口守卫
// 实测：平台标注 "PST" 实为 PDT(UTC-7)。日切落在 PST/PDT 00:00，
// 对应 UTC 07:00(夏令时) / 08:00(冬令时) —— 即北京时间 15:00 / 16:00。
// 窗口内「店铺数据」页会短暂归零（实测 pv 从 3194 掉到 4，而 30 日销量仍 2235），
// 此时写库只会污染历史，因此整段跳过。
function platformDaycutWindow(now = new Date()) {
  const utcHour = now.getUTCHours();
  const inWindow = utcHour >= 7 && utcHour < 9;
  return {
    inWindow,
    utcHour,
    note: inWindow
      ? `UTC ${utcHour} 时处于平台日切窗口（北京时间 15:00-17:00），店铺核心指标不可信，已跳过`
      : null,
  };
}

async function main() {
  const today = localDate();
  const facts = [];
  const errors = [];

  // 让 saveRaw 把原始响应按店隔离；否则 4 店同日写同名文件会互相覆盖。
  process.env.AE_STORE_SCOPE = `env-${STORE_ID}`;

  const api = new WenmaiApi('http://127.0.0.1:3980', 600);
  log('openEnv', STORE_ID, '...');
  const opened = await api.openEnv(STORE_ID, 'default');
  let browser = null;
  for (let i = 0; i < 30; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${opened.cdpPort}`); break; }
    catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
  if (!browser) throw new Error('CDP 未就绪，稳卖环境可能未启动完成');

  const ctx = browser.contexts()[0];
  // openEnv 返回后页面可能还停在扩展中转页（chrome-extension://.../middlePage），
  // 此时 ctx.pages() 里没有 csp 页面，直接取 pages()[0] 会把它误判成登录墙。
  // 实测：登录后第一次 openEnv 命中已开的 csp 标签能抓到数据，closeEnv 后第二次
  // openEnv 因没等跳转而误报 NEEDS_MANUAL_LOGIN。等页面就绪，超时仍按登录墙处理。
  const READY_URL = /csp\.aliexpress\.com|dchain-web\.aliexpress\.com/i;
  let page = null;
  for (let i = 0; i < 30; i++) {
    page = ctx.pages().find((p) => READY_URL.test(p.url())) || null;
    if (page) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!page) page = ctx.pages()[0] || null;

  // Fail Closed：稳卖环境可能落在扩展中转页或登录墙（2026-11-07 实测 461693/461692）。
  // 此时页面文本会被解析成 0 写进 facts，比报错更危险 —— 必须整轮不抓不写。
  const landingUrl = page?.url() || '';
  const loginWall = !READY_URL.test(landingUrl);
  if (loginWall) {
    log('[ABORT] 店铺环境未就绪:', landingUrl.slice(0, 140));
    errors.push({ step: 'loginWall', error: 'NEEDS_MANUAL_LOGIN' });
  }

  // 关键：mtop 响应会被浏览器缓存，导致 reload 时不发请求、捕不到。
  // 逐次抓取必须禁用缓存，否则会静默拿到上一次的数据（比报错更危险）。
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    log('已禁用页面缓存');
  } catch (e) {
    log('禁用缓存失败（继续，但可能抓到缓存数据）:', e.message.slice(0, 60));
  }

  // 店铺标识：从页面顶部店铺名/URL 无法稳定取 shopId，先用 stable 的 storeId 作为主体键
  const storeId = `env:${STORE_ID}`;

  const push = (caliber, value, extra = {}) => {
    facts.push({
      source: SOURCE, storeId, caliber, subject: 'STORE', window: 'today',
      statDate: today, value, ...extra,
    });
  };

  try {
    if (loginWall) {
      // 不抓、不写、不沿用旧值；置非零退出码让编排层明确判失败
      log('本轮跳过全部抓取（NEEDS_MANUAL_LOGIN），请先在稳卖中手动打开该店完成登录');
      // 独立退出码 4：与「抓取有 errors 的 2」区分开，避免编排层误判
      process.exitCode = 4;
    } else {
    // ---------- 销售管理页 ----------
    log('抓取 销售管理 ...');
    const sales = await collect(page, URLS.sales, [API.shopSales, API.itemSummary, API.itemQuery], 14000);

    const shop = sales.get(API.shopSales)?.data?.data;
    if (shop) {
      log('销量:', JSON.stringify(shop));
      if (!DRY) await saveRaw(SOURCE, 'shop-sales-summary', sales.get(API.shopSales), { date: today });
      // 平台自带更新时间，作为新鲜度权威依据（格式 "2026-10-24 23:57:53  PST"）
      const meta = { meta: { platformUpdatedAt: shop.dateUpdateTime || null, platformTimezone: 'PST' } };
      push('sales.qty.total', shop.todaySalesNum ?? null, { ...meta, window: 'today' });
      push('sales.qty.total', shop.recent7dSalesNum ?? null, { ...meta, window: '7d' });
      push('sales.qty.total', shop.recent30dSalesNum ?? null, { ...meta, window: '30d' });
    } else {
      errors.push({ step: 'shopSales', error: 'MISS' });
      for (const w of ['today', '7d', '30d']) push('sales.qty.total', null, { reason: 'FETCH_MISS', window: w });
    }

    const itemSum = sales.get(API.itemSummary)?.data?.data;
    let filterCounts = itemSum;
    let filterSource = itemSum ? 'api' : null;
    if (!filterCounts) {
      // 接口未触发时从页面筛选标签读（"已断码（18）"这类文本就在页面上）
      try {
        const dom = await scrapeSalesFilters(page);
        if (dom && (dom.outOfSize != null || dom.all != null)) {
          filterCounts = { allItemCount: dom.all, outOfSize: dom.outOfSize, outOfStock: dom.outOfStock };
          filterSource = 'dom';
          log('筛选计数取自 DOM:', JSON.stringify(dom));
        }
      } catch (e) {
        log('DOM 兜底失败:', e.message.slice(0, 60));
      }
    }

    if (filterCounts) {
      log('商品状态:', JSON.stringify(filterCounts), '来源:', filterSource);
      if (!DRY && filterSource === 'api') await saveRaw(SOURCE, 'item-summary', sales.get(API.itemSummary), { date: today });
      const m = { meta: { extractedBy: filterSource, platformDelayNote: '断货/断码延迟1小时，售罄预警/备货建议延迟1天' } };
      push('catalog.brokenSize', filterCounts.outOfSize ?? null, m);
      push('catalog.outOfStock', filterCounts.outOfStock ?? null, m);
      if (filterCounts.allItemCount != null) {
        // 平台口径商品数：与店小秘商品库口径不同，必须用独立 caliber，禁止混用
        push('catalog.platformItems', filterCounts.allItemCount, { meta: { extractedBy: filterSource } });
      }
    } else {
      errors.push({ step: 'itemSummary', error: 'MISS_AND_DOM_FAIL' });
      push('catalog.brokenSize', null, { reason: 'FETCH_MISS' });
      push('catalog.outOfStock', null, { reason: 'FETCH_MISS' });
    }

    // 分商品明细：只取本页（后续可扩展翻页），落原始快照供生命周期分析
    const itemPage = sales.get(API.itemQuery)?.data?.data;
    if (itemPage) {
      const list = itemPage.list || [];
      const total = itemPage.total ?? itemPage.totalCount ?? null;
      log(`商品明细: 本页 ${list.length} 条, total=${total}`);
      if (!DRY) await saveRaw(SOURCE, 'item-query-page1', sales.get(API.itemQuery), { date: today });
      // 本页商品的库存四态汇总，作为 store 级库存视图（明确标注是抽样还是全量）
      const agg = list.reduce((a, x) => ({
        real: a.real + (x.realWarehouseInventoryNum || 0),
        locked: a.locked + (x.lockedInventoryNum || 0),
        transit: a.transit + (x.inRoadInventoryNum || 0),
        sales30: a.sales30 + (x.recent30dSalesNum || 0),
      }), { real: 0, locked: 0, transit: 0, sales30: 0 });
      const coverage = total && total > list.length ? 'PARTIAL' : 'FULL';
      push('inventory.actual', agg.real, { meta: { coverage, sampleSize: list.length, total } });
      push('inventory.occupied', agg.locked, { meta: { coverage } });
      push('inventory.transit', agg.transit, { meta: { coverage } });
    }

    // ---------- 资金页 ----------
    log('抓取 财务管理 ...');
    const fund = await collect(page, URLS.fund, [API.fundOverview], 12000);
    const fo = fund.get(API.fundOverview)?.data?.data?.fundOverviewData;
    if (fo) {
      if (!DRY) await saveRaw(SOURCE, 'fund-overview', fund.get(API.fundOverview), { date: today });
      const pick = (k) => {
        const arr = fo[k]?.data;
        if (!Array.isArray(arr) || !arr.length) return null;
        return centToYuan(arr[0].cent);
      };
      const vals = {
        'sales.amount.gmv': pick('sumPaymentAmount'),
        'sales.amount.pending': pick('sumTotalUnsettleAmount'),
        'sales.amount.net': pick('sumNetRevenueAmount'),
      };
      log('资金:', JSON.stringify(vals));
      for (const [c, v] of Object.entries(vals)) {
        push(c, v, v == null ? { reason: 'FIELD_MISS' } : { meta: { sourceField: c, unitNote: 'cent/100' } });
      }
      // 额外原始项一并留存，供后续核对（不直接作为指标）
      if (!DRY) {
        await saveRaw(SOURCE, 'fund-fields-raw', {
          revenue: pick('sumRevenueAmount'),
          expenditure: pick('sumExpenditureAmount'),
          loaned: pick('sumLoanAmount'),
          refundBeforeLoan: pick('sumInSaleRefundAmount'),
          unsettled30d: pick('sumUnsettleAmount'),
          formula: 'gmv = pendingInRange + refundBeforeLoan + loaned',
        }, { date: today });
      }
    } else {
      errors.push({ step: 'fundOverview', error: 'MISS' });
      for (const c of ['sales.amount.gmv', 'sales.amount.pending', 'sales.amount.net']) {
        push(c, null, { reason: 'FETCH_MISS' });
      }
    }

    // ---------- 店铺数据页（流量 + 延迟声明）----------
    log('抓取 店铺数据 ...');
    const store = await collect(page, URLS.store, [API.delayPlan, API.dps], 12000);

    const delay = store.get(API.delayPlan)?.data?.data;
    if (delay) {
      log('延迟声明:', JSON.stringify(delay));
      if (!DRY) await saveRaw(SOURCE, 'delay-plan', store.get(API.delayPlan), { date: today });
      facts.push({
        source: SOURCE, storeId, caliber: 'sales.qty.total', subject: 'DATA_FRESHNESS',
        window: 'today', statDate: today, value: delay.isDelay ? 'DELAYED' : 'OK',
        reason: delay.isDelay ? 'PLATFORM_DECLARED_DELAY' : null,
        meta: { pageModels: delay.pageModels || [] },
      });
    }

    // 店铺核心指标：接口未稳定捕获，从「核心指标」区块读文本（页面上本来就渲染好了）
    const daycut = platformDaycutWindow();
    if (daycut.inWindow && !flags.has('--force-window')) {
      log('[SKIP]', daycut.note);
      for (const c of ['traffic.pv', 'traffic.uv', 'conv.buyers', 'conv.rate', 'lifecycle.activeSkus']) {
        push(c, null, { reason: 'SKIPPED_PLATFORM_DAYCUT', meta: { skipNote: daycut.note } });
      }
    } else try {
      const ov = await scrapeStoreOverview(page);
      if (ov && ov.pv != null) {
        log('店铺核心指标:', JSON.stringify({ ...ov, rawScope: undefined }));
        if (!DRY) await saveRaw(SOURCE, 'store-overview-dom', { ...ov, capturedAt: new Date().toISOString() }, { date: today });

        // 合理性自检：骨架值/解析错位/跨口径矛盾必须显式标记，绝不当真值写库
        const suspects = [];
        const sales30d = shop?.recent30dSalesNum ?? null;
        if (ov.pv != null && ov.uv != null && ov.pv < ov.uv) suspects.push('pv_lt_uv');
        if (ov.convRate != null && (ov.convRate < 0 || ov.convRate > 100)) suspects.push('convRate_out_of_range');
        if (ov.pv === 1 && ov.uv === 1 && ov.activeSkus === 0) suspects.push('likely_skeleton_value');
        // 跨口径矛盾：30日有销量却动销商品数为 0，物理上不可能 —— 基本是平台日切重算中
        if (ov.activeSkus === 0 && sales30d != null && sales30d > 0) suspects.push('activeSkus_zero_but_sales_positive');
        // 量级不符：30日卖上千件但同期浏览量不足百次，不可能
        if (sales30d != null && sales30d > 1000 && ov.pv != null && ov.pv < 100) suspects.push('traffic_magnitude_mismatch');
        if (suspects.length) log('  [WARN] 可疑值:', suspects.join(','));

        const meta = {
          meta: {
            extractedBy: 'dom',
            block: '核心指标',
            window: 'platform_default_30d',
            suspects: suspects.length ? suspects : undefined,
            rawScope: ov.rawScope,
          },
        };
        const flag = suspects.length ? { reason: 'SUSPECT_VALUE' } : {};
        push('traffic.pv', ov.pv, { ...meta, ...flag });
        push('traffic.uv', ov.uv, { ...meta, ...flag });
        push('conv.buyers', ov.buyers, { ...meta, ...flag });
        push('conv.rate', ov.convRate, { ...meta, ...flag, meta: { ...meta.meta, note: '平台直接给出的比率，不自行重算' } });
        push('lifecycle.activeSkus', ov.activeSkus, { ...meta, ...flag });
      } else {
        errors.push({ step: 'storeOverviewDom', error: 'NO_MATCH' });
      }
    } catch (e) {
      errors.push({ step: 'storeOverviewDom', error: e.message.slice(0, 80) });
    }

    const dps = store.get(API.dps)?.data?.data;
    if (dps?.dataSource) {
      const rows = dps.dataSource;
      const sum = rows.reduce((a, r) => ({
        uv: a.uv + (Number(r.uvApp) || 0),
        buyers: a.buyers + (Number(r.payBuyerCntApp) || 0),
      }), { uv: 0, buyers: 0 });
      log(`流量来源 ${rows.length} 条, uv合计=${sum.uv}`);
      if (!DRY) await saveRaw(SOURCE, 'dps-source', store.get(API.dps), { date: today });
      // dps 默认只返回单一来源维度，若 rows 只有 1 条则不足以代表全店
      const coverage = rows.length <= 1 ? 'SINGLE_SOURCE_ONLY' : 'MULTI_SOURCE';
      if (coverage === 'MULTI_SOURCE') {
        push('traffic.uv', sum.uv, { meta: { coverage, sources: rows.length } });
        push('conv.buyers', sum.buyers, { meta: { coverage } });
      } else {
        log('dps 仅返回单来源，跳过全店流量口径（避免把"搜索"当全店）');
      }
    }
    }
  } finally {
    // 落库
    if (loginWall) {
      log('未写盘（NEEDS_MANUAL_LOGIN）：抓不到就说不，绝不沿用旧值');
    } else if (DRY) {
      log('DRY RUN 未写盘，facts:');
      facts.forEach((f) => log(`  ${f.caliber} [${f.window}/${f.subject}] = ${f.value}${f.reason ? ` (${f.reason})` : ''}`));
    } else {
      const r = await appendFacts(facts, { date: today });
      log(`写入完成 written=${r.written} skipped=${r.skipped} changed=${r.changed} / ${r.total}`);
    }
    if (errors.length) log('错误:', JSON.stringify(errors));

    if (!KEEP_OPEN) {
      await api.closeEnv(STORE_ID).catch(() => {});
      log('已关闭店铺环境', STORE_ID);
    } else {
      log('保留店铺环境', STORE_ID, '（--keep-open）');
    }
  }

  process.exit(errors.length ? 2 : 0);
}

main().catch((e) => {
  console.error('[ae] FATAL', e.message);
  process.exit(1);
});
