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

import { WenmaiApi } from '../../../nawu-fetch/lib/wenmai-api.cjs';
import {createHash} from 'node:crypto';
import {assertLivePageIdentity,summarizeInventorySample,assertLiveBrowserIdentity} from '../ceo-live-source-contract.js';
import { chromium } from 'playwright-core';
// metrics-store 直接引用生产实现（只读引用，不复制第二份逻辑）：
// 隔离副本只替换导航/等待，落盘语义必须与生产完全一致。
const { appendFacts, saveRaw, localDate } = await import('file:///F:/yikuaborder-deploy/scripts/metrics-store.mjs');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const STORE_ID = Number(argv.find((a) => /^\d+$/.test(a)) || 400370);
const DRY = flags.has('--dry-run');
const KEEP_OPEN = flags.has('--keep-open');
const CHANNEL = process.env.AE_CHANNEL_ID || channelFor(STORE_ID);
const SOURCE = 'aliexpress';
const CEO_BATCH=argv.find(a=>a.startsWith('--ceo-batch='))?.slice(12)??null;
if(CEO_BATCH&&(!DRY||!KEEP_OPEN||STORE_ID!==400370||CHANNEL!=='2358891'||process.env.AE_SHAPE_OUT))throw new Error('CEO_READ_SCOPE_DENIED');
const session={batchId:CEO_BATCH,envId:String(STORE_ID),channelId:String(CHANNEL),cdpPort:null,cacheDisabled:false,dryRun:DRY,keepOpen:KEEP_OPEN,platformTimezone:null,routes:[],responseEvidence:[],domEvidence:[]};

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

// ── 口径取证（G2-B2 任务B）：仅在 AE_SHAPE_OUT 指定时启用，默认完全不影响采集 ──
const SHAPE_OUT = process.env.AE_SHAPE_OUT || '';
const shape = { enabled: !!SHAPE_OUT, apis: {} };
const TIME_KEY = /date|time|range|start|end|period|day|from|to|beg|finish/i;
const VALUE_KEY = /amount|qty|quantity|count|sum|loan|settle|refund|total|price|gmv|pv|uv|buyer|rate/i;

function shapeOfResponse(urlStr, json) {
  const u = new URL(urlStr);
  const api = (u.pathname.match(/\/h5\/([^/]+)\//) || [])[1] || u.pathname;
  const timeParams = {};
  for (const [k, v] of u.searchParams) if (TIME_KEY.test(k)) timeParams[k] = v;
  const fields = {};
  const walk = (node, path, depth) => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const p = path ? path + '.' + k : k;
      if (typeof v === 'number' && VALUE_KEY.test(k)) fields[p] = v;
      else if (typeof v === 'string' && TIME_KEY.test(k) && v.length <= 40) fields[p] = v;
      else if (typeof v === 'object') walk(v, p, depth + 1);
    }
  };
  walk(json?.data ?? {}, 'data', 0);
  return { pathname: u.pathname, timeParams, dataKeys: Object.keys(json?.data ?? {}), fields };
}

function recordShape(urlStr, json) {
  if (!SHAPE_OUT) return;
  const info = shapeOfResponse(urlStr, json);
  shape.apis[info.pathname] = info;
}


// 金额单位是「分」，必须显式转元 —— 历史上这是 100 倍误差的高发点
const centToYuan = (c) => (typeof c === 'number' ? Math.round(c) / 100 : null);

// ── 导航与等待（G2-B2 修复版）─────────────────────────────────────────────
// 原缺陷：单次 page.goto + 固定 800ms 轮询。
// 全托管后台是 SPA，goto 期间页面会自行 replaceState / 二次导航，把 playwright
// 的导航顶掉并抛 net::ERR_ABORTED；目标 mtop 响应因此根本没发出，轮询白等到超时，
// 整页指标全 MISS。表现为"三次采集仅一次拿全"。
// 修复：
//   1) 每个 page 只挂一个 response 监听器，不再按次挂载/卸载（消除重复监听与串扰）
//   2) 导航 waitUntil:'commit'，ERR_ABORTED 视为"可能已到达"，再校验路由
//   3) 等待条件改为「目标响应到达」事件驱动 + 超时，不用固定睡眠
//   4) 每页最多 3 次，退避重试
//   5) 每次调用前清空该批目标键，杜绝跨页/跨次的陈旧值
const PAGE_STATE = new WeakMap();

function pageState(page) {
  let st = PAGE_STATE.get(page);
  if (!st) {
    st = { captured: new Map(), armed: new Set(), resolvers: new Set() };
    PAGE_STATE.set(page, st);
    page.on('response', async (res) => {
      const m = res.url().match(/\/h5\/([^/]+)\/[\d.]+\//);
      if (!m) return;
      const api = m[1];
      if (!st.armed.has(api) || st.captured.has(api)) return;
      try {
        if(CEO_BATCH)assertLivePageIdentity(page.url(),st.expectedURL);
        const j = await res.json();
        if(CEO_BATCH)assertLivePageIdentity(page.url(),st.expectedURL);
        if (j?.data !== undefined && res.request().timing().startTime >= (st.requestAfter??0)) {
          const u=new URL(res.url());
          session.responseEvidence.push({api,host:u.hostname,channelId:u.searchParams.get('channelId'),observedAt:new Date().toISOString(),route:new URL(page.url()).pathname,captureStartedAt:new Date(st.requestAfter).toISOString(),payloadHash:createHash('sha256').update(JSON.stringify(j)).digest('hex')});
          st.captured.set(api, j);
          recordShape(res.url(), j);
          for (const r of [...st.resolvers]) r();
        }
      } catch {}
    });
  }
  return st;
}

async function navigateTo(page, url) {
  const base = url.split('?')[0];
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 45000 });
    return 'goto';
  } catch (e) {
    if (/ERR_ABORTED/.test(String(e.message))) {
      // 被页面自身导航顶掉：只要最终路由到目标页就算到达
      try {
        await page.waitForURL((u) => u.href.split('?')[0] === base, { timeout: 15000 });
        return 'aborted-but-arrived';
      } catch {
        return 'aborted-no-route';
      }
    }
    throw e;
  }
}

function waitForWanted(st, wanted, timeoutMs) {
  const missing = () => wanted.filter((a) => !st.captured.has(a));
  if (missing().length === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => {
      if (missing().length === 0) { cleanup(); resolve(true); }
    };
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); st.resolvers.delete(done); };
    st.resolvers.add(done);
  });
}

async function collect(page, url, wanted, waitMs = 12000, attempts = 3) {
  const st = pageState(page);
  st.requestAfter=Date.now();st.expectedURL=url;
  // 每次采集都从零开始：清掉本批目标的旧值，保证失败不会返回上一次的结果
  for (const a of wanted) { st.captured.delete(a); st.armed.add(a); }
  let lastErr = null;
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        st.requestAfter=Date.now();for(const a of wanted)st.captured.delete(a);
        const how = await navigateTo(page, url);
        if(CEO_BATCH)assertLivePageIdentity(page.url(),url);
        const ok = await waitForWanted(st, wanted, waitMs);
        if(CEO_BATCH)assertLivePageIdentity(page.url(),url);
        const actual=new URL(page.url());
        session.routes.push({name:url===URLS.sales?'sales':url===URLS.fund?'fund':'store',host:actual.hostname,pathname:actual.pathname,channelId:actual.searchParams.get('channelId'),observedAt:new Date().toISOString()});
        const missing = wanted.filter((a) => !st.captured.has(a));
        if (missing.length === 0) { log(`${url.split('/').pop()} 第${attempt}次取全 (${how})`); return st.captured; }
        log(`${url.split('/').pop()} 第${attempt}次缺 ${missing.length} 项 (${how}${ok ? '' : ', 等待超时'})`);
        if (attempt < attempts) {
          await page.waitForTimeout(400 * attempt);
          try { await page.reload({ waitUntil: 'commit', timeout: 30000 }); } catch {}
        }
      } catch (e) {
        lastErr = e;
        if(e.code==='PAGE_IDENTITY_MISMATCH'){for(const a of wanted)st.captured.delete(a);throw e;}
        log(`${url.split('/').pop()} 第${attempt}次异常: ${String(e.message).slice(0, 70)}`);
        if (attempt < attempts) await page.waitForTimeout(600 * attempt);
      }
      // 诊断：仍缺目标时记录页面真实落点（判定是否被重定向到登录/验证）
      const stillMissing = wanted.filter((a) => !st.captured.has(a));
      if (stillMissing.length) {
        try { log('  诊断 当前URL=' + page.url().slice(0, 120) + ' 标题=' + (await page.title()).slice(0, 40) + ' 缺=' + stillMissing.length); } catch {}
      }
    }
    if(CEO_BATCH)assertLivePageIdentity(page.url(),url);
    if (lastErr) log('最终错误:', String(lastErr.message).slice(0, 90));
    return st.captured;
  } finally {
    for (const a of wanted) st.armed.delete(a);
  }
}

// DOM 兜底提取：某些 mtop 接口只在特定交互后才请求，抓不到时从页面文本取。
// 只在接口缺失时使用，并在 meta 标注 extractedBy='dom' 保持透明。
async function scrapeSalesFilters(page) {
  if(CEO_BATCH)assertLivePageIdentity(page.url(),URLS.sales);
  const result=await page.evaluate(() => {
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
  if(CEO_BATCH)assertLivePageIdentity(page.url(),URLS.sales);
  session.domEvidence.push({name:'sales',block:'salesFilters',channelId:CHANNEL,observedAt:new Date().toISOString(),payloadHash:createHash('sha256').update(JSON.stringify(result)).digest('hex')});
  return result;
}

async function scrapeStoreOverview(page) {
  if(CEO_BATCH)assertLivePageIdentity(page.url(),URLS.store);
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

  const result=await page.evaluate(() => {
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
  if(CEO_BATCH)assertLivePageIdentity(page.url(),URLS.store);
  session.domEvidence.push({name:'store',block:'coreMetrics',channelId:CHANNEL,observedAt:new Date().toISOString(),payloadHash:createHash('sha256').update(JSON.stringify(result)).digest('hex')});
  return result;
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

  session.phase='OPEN_ENV';
  const api = new WenmaiApi('http://127.0.0.1:3980', 600);
  log('openEnv', STORE_ID, '...');
  const opened = await api.openEnv(STORE_ID, 'default');
  session.phase='CONNECT_CDP';
  session.cdpPort=Number(opened.cdpPort);
  session.openEnv={envId:String(STORE_ID),cdpPort:session.cdpPort,pid:Number(opened.pid),method:'openEnv',endpoint:'http://127.0.0.1:3980/openEnv'};
  if(!Number.isInteger(session.cdpPort)||session.cdpPort<1024||session.cdpPort>65535||!Number.isInteger(session.openEnv.pid)||session.openEnv.pid<=0)throw new Error('CDP_IDENTITY_MISMATCH');
  const response=await fetch(`http://127.0.0.1:${session.cdpPort}/json/version`,{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('CDP_IDENTITY_MISMATCH');
  const observedBrowser=await response.json();
  session.browser={port:session.cdpPort,product:observedBrowser.Browser,protocol:observedBrowser['Protocol-Version']};
  let browser = null;
  for (let i = 0; i < 30; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${opened.cdpPort}`); break; }
    catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
  if (!browser) throw new Error('CDP 未就绪，稳卖环境可能未启动完成');

  session.phase='BROWSER_IDENTITY';
  const browserProbe=await browser.newBrowserCDPSession();
  try{
    const processes=await browserProbe.send('SystemInfo.getProcessInfo');
    const version=await browserProbe.send('Browser.getVersion');
    const observedPid=processes.processInfo?.find(p=>p.type==='browser')?.id;
    session.browserIdentity=assertLiveBrowserIdentity({envId:String(STORE_ID),opened:{pid:Number(opened.pid),cdpPort:Number(opened.cdpPort)},connected:{pid:observedPid,cdpPort:session.cdpPort,product:version.product,observedProduct:session.browser.product}});
  }finally{await browserProbe.detach();}

  session.phase='BROWSER_CONTEXT';
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('csp.aliexpress.com')) || ctx.pages()[0];

  // 关键：mtop 响应会被浏览器缓存，导致 reload 时不发请求、捕不到。
  // 逐次抓取必须禁用缓存，否则会静默拿到上一次的数据（比报错更危险）。
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    session.cacheDisabled=true;
    log('已禁用页面缓存');
  } catch (e) {
    if(CEO_BATCH)throw new Error('FRESH_COLLECTION_CACHE_GUARD_FAILED');
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
    // ---------- 销售管理页 ----------
    log('抓取 销售管理 ...');
    const sales = await collect(page, URLS.sales, [API.shopSales, API.itemSummary, API.itemQuery], 14000);

    const shop = sales.get(API.shopSales)?.data?.data;
    if (shop) {
      log('销量:', JSON.stringify(shop));
      if (!DRY) await saveRaw(SOURCE, 'shop-sales-summary', sales.get(API.shopSales), { date: today });
      // 平台自带更新时间，作为新鲜度权威依据（格式 "2026-10-24 23:57:53  PST"）
      session.platformTimezone=String(shop.dateUpdateTime??'').match(/\b(PST|PDT)\b/)?.[1]??null;
      const meta = { meta: { platformUpdatedAt: shop.dateUpdateTime || null, platformTimezone: session.platformTimezone } };
      push('sales.qty.total', shop.todaySalesNum ?? null, { ...meta, meta:{...meta.meta,sourceField:'todaySalesNum'}, window: 'today' });
      push('sales.qty.total', shop.recent7dSalesNum ?? null, { ...meta, meta:{...meta.meta,sourceField:'recent7dSalesNum'}, window: '7d' });
      push('sales.qty.total', shop.recent30dSalesNum ?? null, { ...meta, meta:{...meta.meta,sourceField:'recent30dSalesNum'}, window: '30d' });
    } else {
      errors.push({ step: 'shopSales', error: 'MISS' });
      for (const w of ['today', '7d', '30d']) push('sales.qty.total', null, { reason: 'FETCH_MISS', window: w });
    }

    const itemSum = sales.get(API.itemSummary)?.data?.data;
    let filterCounts = itemSum;
    let filterSource = itemSum ? 'api' : null;
    if (!filterCounts) {
      // 接口未触发、或响应 payload 为空（页面尚未 hydrate）时，从页面筛选标签读。
      // 原实现只读一次 DOM，页面稍晚渲染就永久 MISS；改为有界轮询等待标签出现。
      try {
        let dom = await scrapeSalesFilters(page);
        for (let i = 0; i < 10 && !(dom && (dom.outOfSize != null || dom.all != null)); i++) {
          await page.waitForTimeout(1000);
          dom = await scrapeSalesFilters(page);
        }
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
      const agg=summarizeInventorySample(itemPage);
      log(`商品明细: 本页 ${agg.sampleSize} 条, total=${agg.total}`);
      if (!DRY) await saveRaw(SOURCE, 'item-query-page1', sales.get(API.itemQuery), { date: today });
      const meta={coverage:agg.coverage,sampleSize:agg.sampleSize,total:agg.total};
      for(const [caliber,value] of [['inventory.actual',agg.real],['inventory.occupied',agg.locked],['inventory.transit',agg.transit]])push(caliber,value,{meta,...(value===null?{reason:'FIELD_MISS'}:{})});
    } else {
      // 原实现此处静默跳过，导致三项库存指标直接不出现、缺失被吞。
      // 口径要求：缺失必须显式为 null 并带原因，分母恒为 17。
      errors.push({ step: 'itemQuery', error: 'MISS' });
      for (const c of ['inventory.actual', 'inventory.occupied', 'inventory.transit']) {
        push(c, null, { reason: 'FETCH_MISS' });
      }
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
        push(c, v, v == null ? { reason: 'FIELD_MISS' } : { meta: { sourceField: {'sales.amount.gmv':'sumPaymentAmount','sales.amount.pending':'sumTotalUnsettleAmount','sales.amount.net':'sumNetRevenueAmount'}[c],unitNote:'cent/100',periodStatus:'UNVERIFIED_PERIOD' } });
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
        if (ov.pv != null && ov.uv != null && ov.pv < ov.uv) suspects.push('pv_lt_uv');
        if (ov.convRate != null && (ov.convRate < 0 || ov.convRate > 100)) suspects.push('convRate_out_of_range');
        if (ov.pv === 1 && ov.uv === 1 && ov.activeSkus === 0) suspects.push('likely_skeleton_value');
        // 无平台窗口证据时，不拿销量跨窗口推断流量或动销值异常。
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
        // 同上：原实现此处只记错误不产出事实，导致 5 项流量/转化指标凭空消失。
        errors.push({ step: 'storeOverviewDom', error: 'NO_MATCH' });
        for (const c of ['traffic.pv', 'traffic.uv', 'conv.buyers', 'conv.rate', 'lifecycle.activeSkus']) {
          push(c, null, { reason: 'FETCH_MISS' });
        }
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
  } finally {
    // 最终页面核验；异常不发布事实。
    if(CEO_BATCH)assertLivePageIdentity(page.url(),URLS.store);
    // 落库
    if (SHAPE_OUT) {
      try { const fs = await import('node:fs'); fs.writeFileSync(SHAPE_OUT, JSON.stringify(shape, null, 2)); log('shape 已写出:', SHAPE_OUT); } catch (e) { log('shape 写出失败:', e.message); }
    }
    if (DRY) {
      log('SESSIONJSON '+JSON.stringify(session));
      log('DRY RUN 未写盘，facts:');
      facts.forEach((f) => log(`  ${f.caliber} [${f.window}/${f.subject}] = ${f.value}${f.reason ? ` (${f.reason})` : ''}`));
      // 机器可读：保留顶层 window 与 meta.window，便于下游区分"平台口径"与"采集器默认标签"
      facts.forEach((f) => log('FACTJSON ' + JSON.stringify({
        caliber: f.caliber, subject: f.subject, window: f.window,storeId:f.storeId,statDate:f.statDate,
        meta:f.meta?Object.fromEntries(Object.entries(f.meta).filter(([k])=>k!=='rawScope')):null,
        metaWindow: f.meta?.window ?? null, value: f.value,
        reason: f.reason ?? null, sourceField: f.meta?.sourceField ?? null,
        extractedBy: f.meta?.extractedBy ?? null, suspects: f.meta?.suspects ?? null,
      })));
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
  const known=String(e.code??'').match(/^[A-Z_0-9]+$/)?.[0]??(/openEnv\(/.test(String(e.message))?'WENMAI_OPEN_ENV_FAILED':/CDP 未就绪/.test(String(e.message))?'CDP_NOT_READY':/^[A-Z_]+$/.test(String(e.message))?e.message:e.name==='TypeError'?'COLLECTOR_TYPE_ERROR':'COLLECTOR_FAILED');
  console.log('[ae] SESSIONJSON '+JSON.stringify(session));
  console.error('[ae] FATALCODE '+known);
  process.exit(1);
});
