#!/usr/bin/env node
// 运营分析库构建器（SQLite）
//
// 目标：把散落在 data/metrics 下的多个 JSONL/JSON 源，规范化成**可跨表 JOIN** 的分析库，
//       让运营问题能用一条 SQL 回答（例：这个 SKU 的供货价覆盖成本几倍、还够卖几天）。
//
// 铁律（继承 docs/METRICS_PIPELINE.md）：
//   1. 只导原始事实，不存算好的结论；口径由 config/metrics-schema.json 定义
//   2. 抓不到就 NULL，绝不填 0、绝不沿用上一周期
//   3. 每个源独立导入：缺源只记录，不中断整库构建
//
// 产出：data/metrics/ops.db（gitignore，数据不入库；DDL 在本文件内是唯一权威）
//
// 用法：
//   node scripts/build-ops-db.mjs              # 增量重建（保留历史日期的快照）
//   node scripts/build-ops-db.mjs --rebuild    # 清空重建
//   node scripts/build-ops-db.mjs --json       # 输出机器可读摘要

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const METRICS = path.join(ROOT, 'data', 'metrics');
const DB_PATH = path.join(METRICS, 'ops.db');
const SCHEMA_PATH = path.join(ROOT, 'config', 'metrics-schema.json');
const STORES_PATH = path.join(ROOT, 'config', 'ops-stores.json');

const REBUILD = process.argv.includes('--rebuild');
const AS_JSON = process.argv.includes('--json');

// ───────────────────────────── 工具 ─────────────────────────────

const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const toBool = (v) => (v === null || v === undefined ? null : v === true || v === 1 || v === 'true' ? 1 : 0);
/** 平台有的字段是对象/数组（如 distributeChannel），SQLite 只能绑标量 → 统一转文本 */
const toText = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
};
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readJsonl = (p) => {
  try {
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};
const listDir = (p) => { try { return fs.readdirSync(p).sort(); } catch { return []; } };

/** 解析 "11.90~33.20" → [11.9, 33.2] */
function parseInterval(s) {
  if (s === null || s === undefined) return [null, null];
  const parts = String(s).split('~');
  const lo = toNum(parts[0]);
  const hi = parts.length > 1 ? toNum(parts[1]) : lo;
  return [lo, hi];
}

/** 毫秒时间戳 / 字符串 → 'YYYY-MM-DD' */
function toDate(v) {
  const n = toNum(v);
  if (n && n > 1e11) return new Date(n).toISOString().slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

const log = [];
const stats = {};
function note(src, rows, extra = {}) {
  stats[src] = { rows, ...extra };
  log.push(`  ${src.padEnd(22)} ${String(rows).padStart(7)} 行 ${extra.note ? '· ' + extra.note : ''}`);
}

// ───────────────────────────── DDL ─────────────────────────────

const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ══════════ 元数据 ══════════
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ══════════ 维度 ══════════
-- 店铺维度：displayName 是唯一对外口径，envId 仅技术句柄（config/ops-stores.json namingRule）
CREATE TABLE IF NOT EXISTS dim_store (
  store_id   TEXT PRIMARY KEY,     -- env:<envId>，与 facts 的 storeId 对齐
  env_id     TEXT,
  name       TEXT NOT NULL,        -- 店铺名，报告一律用这个
  mode       TEXT,                 -- full-managed / pop
  channel_id TEXT,
  platform   TEXT,
  enabled    INTEGER,
  note       TEXT
);

-- 口径维度：从 config/metrics-schema.json 直灌，禁止代码里造词
CREATE TABLE IF NOT EXISTS dim_caliber (
  caliber         TEXT PRIMARY KEY,
  label           TEXT,
  definition      TEXT,
  unit            TEXT,
  source          TEXT,
  comparable_with TEXT,   -- JSON array
  warning         TEXT
);

-- 目标维度：增收/净利目标的机器可读形态，避免硬编码在报告里
CREATE TABLE IF NOT EXISTS dim_target (
  store_id     TEXT,
  metric       TEXT,
  target_value REAL,
  period       TEXT,        -- 例 2026-12
  unit         TEXT,
  kind         TEXT,        -- goal(必须达成) / constraint(约束下限)
  note         TEXT,
  PRIMARY KEY (store_id, metric, period)
);

-- 商品维度（平台 item 级，74 字段里挑经营相关）
CREATE TABLE IF NOT EXISTS dim_item (
  store_id           TEXT NOT NULL,
  item_id            TEXT NOT NULL,
  title              TEXT,
  item_type          INTEGER,   -- 平台枚举：1 / 2 / 12（实测三种，非只有 1/2）
  item_status        INTEGER,
  cat_l1             TEXT,
  cat_l2             TEXT,
  cat_l3             TEXT,
  cat_l4             TEXT,
  first_up_shelf     TEXT,
  distribute_channel TEXT,
  image_url          TEXT,
  pop_item_id        TEXT,
  first_seen_date    TEXT,
  last_seen_date     TEXT,
  PRIMARY KEY (store_id, item_id)
);

-- SKU 维度（规格级；供货价/售价/库存都在这一层）
CREATE TABLE IF NOT EXISTS dim_sku (
  store_id   TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  sku_id     TEXT NOT NULL,
  goods_id   TEXT,
  props      TEXT,      -- JSON: [{propertyText,propertyValue}]
  ship_from  TEXT,
  sku_type   INTEGER,
  PRIMARY KEY (store_id, item_id, sku_id)
);

-- ══════════ 店铺级事实 ══════════
-- 长表：任意 caliber × window 都能装进来，新增指标零改表
CREATE TABLE IF NOT EXISTS fact_store_daily (
  stat_date           TEXT NOT NULL,
  store_id            TEXT NOT NULL,
  caliber             TEXT NOT NULL,
  subject             TEXT NOT NULL DEFAULT 'STORE',
  window              TEXT NOT NULL DEFAULT 'today',
  value               REAL,              -- 抓不到必为 NULL，不得填 0
  unit                TEXT,
  reason              TEXT,              -- FETCH_MISS / STALE / SKIPPED_DAYCUT ...
  platform_updated_at TEXT,
  captured_at         TEXT,
  revision            INTEGER DEFAULT 1,
  PRIMARY KEY (stat_date, store_id, caliber, subject, window)
);

-- 流量漏斗宽表（全托管生意参谋 store-overview，多周期）
-- 这是"增收"的第一性数据：曝光 → 访客 → 加购 → 支付
CREATE TABLE IF NOT EXISTS fact_store_funnel (
  store_id            TEXT NOT NULL,
  period_key          TEXT NOT NULL,   -- Real_Time_Today / Last_7Days / Last_30Days / Day-3
  captured_date       TEXT NOT NULL,
  period_label        TEXT,
  stat_date           TEXT,
  search_exp_pv       REAL,   -- 搜索曝光量
  pv                  REAL,   -- 浏览量
  uv                  REAL,   -- 店铺访客数（去重）
  item_uv             REAL,   -- 商品访客数
  addcart_buyer_cnt   REAL,   -- 商品加购人数
  wishlist_buyer_cnt  REAL,   -- 商品收藏人数
  addcart_item_qty    REAL,   -- 加购件数
  pay_buyer_cnt       REAL,   -- 支付买家数
  pay_item_qty        REAL,   -- 支付件数（含货通，与 sales.qty.total 同源口径）
  pay_conv_rate       REAL,   -- 支付转化率（平台给，比率非百分数）
  selling_item_cnt    REAL,   -- 在售商品数
  buy_not_sel_rate    REAL,
  -- 环比（平台 cycleData，相对上一等长周期）
  cyc_search_exp_pv   REAL,
  cyc_pv              REAL,
  cyc_uv              REAL,
  cyc_addcart_buyer   REAL,
  cyc_wishlist_buyer  REAL,
  cyc_pay_buyer       REAL,
  cyc_pay_item        REAL,
  cyc_pay_conv_rate   REAL,
  -- 平台派生比率（原样存，不自己再算一遍）
  uv_per_exp          REAL,   -- 曝光→访客
  cart_per_uv         REAL,   -- 访客→加购
  payqty_per_uv       REAL,   -- 访客→件数
  payqty_per_buyer    REAL,   -- 客单件数
  shop_guard          TEXT,   -- PASS 表示 --expect-shop 自证通过
  PRIMARY KEY (store_id, period_key, captured_date)
);

-- 国家/地区漏斗（TOP10 完整漏斗 + 21 国访客占比）
CREATE TABLE IF NOT EXISTS fact_store_country (
  store_id          TEXT NOT NULL,
  period_key        TEXT NOT NULL,
  captured_date     TEXT NOT NULL,
  country           TEXT NOT NULL,
  country_id        TEXT,
  stat_date         TEXT,
  uv                REAL,
  pv                REAL,
  search_exp_pv     REAL,
  addcart_buyer_cnt REAL,
  addcart_item_qty  REAL,
  wishlist_buyer_cnt REAL,
  pay_item_qty      REAL,
  pay_buyer_cnt     REAL,
  pay_conv_rate     REAL,
  cyc_uv            REAL,
  cyc_pay_item      REAL,
  cyc_pay_buyer     REAL,
  cyc_pay_conv_rate REAL,
  PRIMARY KEY (store_id, period_key, captured_date, country)
);

-- ══════════ 商品 / SKU 级事实 ══════════
CREATE TABLE IF NOT EXISTS fact_item_snapshot (
  captured_date       TEXT NOT NULL,
  store_id            TEXT NOT NULL,
  item_id             TEXT NOT NULL,
  today_sales         REAL,
  recent7d_sales      REAL,
  recent30d_sales     REAL,
  total_sales         REAL,
  real_inv            REAL,   -- 实仓库存
  locked_inv          REAL,   -- 占用
  inroad_inv          REAL,   -- 在途
  sellable_qty        REAL,   -- 平台可售额度（非物理库存！禁止当库存用）
  pred7d              REAL,
  pred30d             REAL,
  pred60d             REAL,
  pred90d             REAL,
  suggest_prepare7d   REAL,
  suggest_prepare14d  REAL,
  suggest_prepare21d  REAL,
  sellable_days       REAL,
  supply_price_low    REAL,   -- 供货价区间（CNY，平台付给你的价）
  supply_price_high   REAL,
  sold_out_alert      INTEGER,
  stock_up_recommend  INTEGER,
  PRIMARY KEY (captured_date, store_id, item_id)
);

CREATE TABLE IF NOT EXISTS fact_sku_snapshot (
  captured_date     TEXT NOT NULL,
  store_id          TEXT NOT NULL,
  item_id           TEXT NOT NULL,
  sku_id            TEXT NOT NULL,
  today_sales       REAL,
  recent7d_sales    REAL,
  recent30d_sales   REAL,
  total_sales       REAL,
  real_inv          REAL,
  locked_inv        REAL,
  inroad_inv        REAL,
  sellable_qty      REAL,
  pred7d            REAL,
  pred30d           REAL,
  pred60d           REAL,
  pred90d           REAL,
  suggest_prepare7d REAL,
  suggest_prepare14d REAL,
  suggest_prepare21d REAL,
  supply_price      REAL,   -- 供货价 CNY（全托管下这是你的收入单价）
  eff_supply_price  REAL,   -- 生效供货价
  fixed_price       REAL,   -- 前台展示价（CNY 或原币，看 originalCurrencyCode）
  promotion_price   REAL,
  sellable_days     REAL,
  sellable_alert    INTEGER,
  stock_health      INTEGER,
  PRIMARY KEY (captured_date, store_id, item_id, sku_id)
);

-- ══════════ 成本 / 利润 ══════════
-- 采购成本（店小秘入库流水派生，confidence 分级）
CREATE TABLE IF NOT EXISTS fact_cost (
  sku_code   TEXT PRIMARY KEY,
  price      REAL,   -- 最近一次入库单价 CNY
  avg_after  REAL,   -- 入库后移动均价 CNY
  cost_type  TEXT,   -- 采购入库 / 手动入库 / 转移入库 / 商品参考价
  confidence TEXT,   -- high / medium / low
  wh         TEXT,
  item_code  TEXT,
  entry_time TEXT,
  built_at   TEXT
);

-- SKU 成本桥：店小秘编码 ↔ 平台 skuId ↔ 采购成本
-- 存在原因：平台 skuId(12000056960385262) / goodsId(1034281525939) 与店小秘编码(WBBGJ114-gold)
-- 是三套互不相通的 ID，没有桥就无法把成本归到平台 SKU。桥来自成品 CSV
-- D:/ecom-translator/output/店铺数据/商品级实收_<date>.csv（含「店小秘SKU,平台skuId,采购成本CNY,成本档」）
CREATE TABLE IF NOT EXISTS dim_sku_cost_bridge (
  platform_sku_id TEXT PRIMARY KEY,
  item_id         TEXT,
  store_name      TEXT,
  dxm_sku_code    TEXT,
  title           TEXT,
  revenue90d_cny  REAL,
  settle_count    REAL,
  cost_cny        REAL,
  cost_tier       TEXT,   -- high/medium/low：low=商品参考价兜底，不可当审计成本
  source_file     TEXT,
  built_date      TEXT
);

-- 商品级经营估算（商品主数据，90 天窗口；est* 是估算不是审计结论）
CREATE TABLE IF NOT EXISTS fact_item_profit (  built_date        TEXT NOT NULL,
  store_id          TEXT NOT NULL,
  item_id           TEXT NOT NULL,
  title             TEXT,
  category          TEXT,
  quality_score     REAL,
  level_desc        TEXT,
  dsr               REAL,
  snad_ratio        REAL,
  gmv_rate          TEXT,
  revenue90d_cny    REAL,
  settle_count      REAL,
  cost_median_cny   REAL,
  penalty_cny       REAL,
  burden_rate_pct   REAL,
  est_gross_profit  REAL,
  est_gross_margin  REAL,   -- 百分数
  variant_count     INTEGER,
  PRIMARY KEY (built_date, store_id, item_id)
);

-- ══════════ 市场（极鲸云 ixspy） ══════════
CREATE TABLE IF NOT EXISTS fact_market (
  stat_date TEXT NOT NULL,
  caliber   TEXT NOT NULL,
  subject   TEXT NOT NULL,   -- itemId 或 keyword
  window    TEXT,
  value     REAL,
  meta      TEXT,            -- 原样保留 api/rank/store 等溯源信息
  captured_at TEXT,
  PRIMARY KEY (stat_date, caliber, subject, window)
);

-- ══════════ 索引 ══════════
CREATE INDEX IF NOT EXISTS ix_daily_cal   ON fact_store_daily(caliber, window, stat_date);
CREATE INDEX IF NOT EXISTS ix_daily_store ON fact_store_daily(store_id, stat_date);
CREATE INDEX IF NOT EXISTS ix_snap_item   ON fact_item_snapshot(store_id, item_id);
CREATE INDEX IF NOT EXISTS ix_snap_sku    ON fact_sku_snapshot(store_id, item_id);
CREATE INDEX IF NOT EXISTS ix_profit_item ON fact_item_profit(store_id, item_id);
CREATE INDEX IF NOT EXISTS ix_market_subj ON fact_market(subject, caliber);
`;

// ═════════════════ 导入器 ═════════════════

function importMeta(db) {
  db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('db_built_at', new Date().toISOString());
  db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('builder', 'scripts/build-ops-db.mjs');
  db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('source_of_caliber', 'config/metrics-schema.json');
  db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('rule', '原始事实落库/指标永远重算/抓不到写NULL');
  note('meta', 4);
}

function importStores(db) {
  const cfg = readJson(STORES_PATH);
  const stores = cfg?.stores ?? [];
  const stmt = db.prepare(`INSERT OR REPLACE INTO dim_store
    (store_id,env_id,name,mode,channel_id,platform,enabled,note) VALUES(?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const s of stores) {
    stmt.run(`env:${s.envId}`, String(s.envId), s.displayName, s.mode ?? null,
      s.channelId != null ? String(s.channelId) : null, s.platformEntry ?? null,
      toBool(s.enabled), s.entryNote ?? null);
    n++;
  }
  note('dim_store', n, { note: stores.map((s) => s.displayName).join(' / ') });
}

function importCalibers(db) {
  const schema = readJson(SCHEMA_PATH);
  if (!schema?.calibers) { note('dim_caliber', 0, { note: 'metrics-schema.json 缺失' }); return schema; }
  const stmt = db.prepare(`INSERT OR REPLACE INTO dim_caliber
    (caliber,label,definition,unit,source,comparable_with,warning) VALUES(?,?,?,?,?,?,?)`);
  let n = 0;
  for (const [k, v] of Object.entries(schema.calibers)) {
    stmt.run(k, v.label ?? null, v.definition ?? null, v.unit ?? null, v.source ?? null,
      JSON.stringify(v.comparableWith ?? []), v.warning ?? null);
    n++;
  }
  note('dim_caliber', n, { note: `schema v${schema.version ?? '?'}` });
  return schema;
}

/**
 * 目标维度。
 * 权威：docs/TARGET_DECISION_2026-11-10.md（2026-11-10 中午 Human 裁决）
 *   「12 月日均产出 500 单（必须）」= 日均 500 件 sales.qty.total（含货通），
 *   **已覆盖** CODEX_STATUS 原定的「每日 ≥200 件」。
 *   月净利 ¥12,000 保留为约束（C4：销量为主指标，净利大概率随销量自动达成）。
 */
function importTargets(db) {
  const rows = [
    ['env:400370', 'sales.qty.total', 15000, '2026-12', '件', 'goal', '日均500件×30天（TARGET_DECISION 裁决，已覆盖旧的200/天）'],
    ['env:400370', 'sales.qty.total.daily', 500, '2026-12-daily', '件', 'goal', '日≥500件 sales.qty.total（含货通）'],
    ['env:400370', 'net.profit.monthly', 12000, '2026-12', 'CNY', 'constraint', '月净利≥12000（C4 降级为约束：500件/天达成后大概率自动达成）'],
  ];
  const stmt = db.prepare(`INSERT OR REPLACE INTO dim_target(store_id,metric,target_value,period,unit,kind,note) VALUES(?,?,?,?,?,?,?)`);
  for (const r of rows) stmt.run(...r);
  note('dim_target', rows.length, { note: '日均500件/月15000件（覆盖旧的200/天）' });
}

/** facts/<source>/<date>.jsonl → fact_store_daily（同 key 取最新 capturedAt） */
function importStoreDaily(db) {
  const root = path.join(METRICS, 'facts');
  const stmt = db.prepare(`INSERT OR REPLACE INTO fact_store_daily
    (stat_date,store_id,caliber,subject,window,value,unit,reason,platform_updated_at,captured_at,revision)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  const bySource = [];
  for (const source of listDir(root)) {
    const dir = path.join(root, source);
    if (!fs.statSync(dir).isDirectory()) continue;
    let srcN = 0;
    for (const f of listDir(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const date = f.replace('.jsonl', '');
      const rows = readJsonl(path.join(dir, f));
      const latest = new Map();
      for (const r of rows) {
        const k = [r.caliber, r.storeId ?? '-', r.subject ?? '-', r.window ?? '-'].join('|');
        const prev = latest.get(k);
        if (!prev || String(r.capturedAt ?? '') >= String(prev.capturedAt ?? '')) latest.set(k, r);
      }
      for (const r of latest.values()) {
        if (!r.caliber) continue;
        stmt.run(
          r.statDate ?? date, r.storeId ?? '-', r.caliber,
          r.subject ?? 'STORE', r.window ?? 'today',
          r.value === undefined ? null : r.value,
          r.unit ?? null, r.reason ?? null,
          r.meta?.platformUpdatedAt ?? null, r.capturedAt ?? null, r.revision ?? 1,
        );
        n++; srcN++;
      }
    }
    if (srcN) bySource.push(`${source}:${srcN}`);
  }
  note('fact_store_daily', n, { note: bySource.join(' ') });
}

/** traffic/store-overview-*.json → 漏斗宽表 + 国家表 */
function importFunnel(db) {
  const dir = path.join(METRICS, 'facts', 'traffic');
  const sFunnel = db.prepare(`INSERT OR REPLACE INTO fact_store_funnel
    (store_id,period_key,captured_date,period_label,stat_date,search_exp_pv,pv,uv,item_uv,
     addcart_buyer_cnt,wishlist_buyer_cnt,addcart_item_qty,pay_buyer_cnt,pay_item_qty,pay_conv_rate,
     selling_item_cnt,buy_not_sel_rate,cyc_search_exp_pv,cyc_pv,cyc_uv,cyc_addcart_buyer,
     cyc_wishlist_buyer,cyc_pay_buyer,cyc_pay_item,cyc_pay_conv_rate,
     uv_per_exp,cart_per_uv,payqty_per_uv,payqty_per_buyer,shop_guard)
    VALUES(${Array(30).fill('?').join(',')})`);
  const sCountry = db.prepare(`INSERT OR REPLACE INTO fact_store_country
    (store_id,period_key,captured_date,country,country_id,stat_date,uv,pv,search_exp_pv,
     addcart_buyer_cnt,addcart_item_qty,wishlist_buyer_cnt,pay_item_qty,pay_buyer_cnt,pay_conv_rate,
     cyc_uv,cyc_pay_item,cyc_pay_buyer,cyc_pay_conv_rate)
    VALUES(${Array(19).fill('?').join(',')})`);

  // envId → storeId 映射（文件名里的 captured_date 从 builtAt 取）
  const storeCfg = readJson(STORES_PATH)?.stores ?? [];
  const nameToEnv = new Map(storeCfg.map((s) => [s.displayName, `env:${s.envId}`]));

  let nf = 0, nc = 0;
  for (const f of listDir(dir)) {
    if (!f.startsWith('store-overview-') || !f.endsWith('.json')) continue;
    const j = readJson(path.join(dir, f));
    if (!j?.stores) continue;
    const capturedDate = j.builtAt ?? f.replace('store-overview-', '').replace('.json', '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    for (const [storeName, s] of Object.entries(j.stores)) {
      const storeId = nameToEnv.get(storeName) ?? `env:${s.envId}`;
      for (const [periodKey, p] of Object.entries(s.periods ?? {})) {
        if (!p || p.ok === false) continue;
        const m = p.metrics ?? {};
        const d = p.derived ?? {};
        const v = (k) => (m[k] ? toNum(m[k].value) : null);
        const c = (k) => (m[k] ? toNum(m[k].cycleData) : null);
        sFunnel.run(
          storeId, periodKey, capturedDate, p.periodLabel ?? null, p.statDate ?? null,
          v('searchExpPv'), v('pv'), v('uv'), v('itemUv'),
          v('itemAddcartBuyerCnt'), v('itemWishlistBuyerCnt'), v('addcartItemQty'),
          v('payBuyerCnt'), v('payItemQty'), v('payConvRate'),
          v('sellingItmCnt'), v('buy_not_sel_rate'),
          c('searchExpPv'), c('pv'), c('uv'), c('itemAddcartBuyerCnt'),
          c('itemWishlistBuyerCnt'), c('payBuyerCnt'), c('payItemQty'), c('payConvRate'),
          toNum(d['曝光访客率_uv_per_exp']), toNum(d['加购率_cartBuyer_per_uv']),
          toNum(d['访客支付件数_payItemQty_per_uv']), toNum(d['客单件数_payItemQty_per_buyer']),
          p.shopGuard ?? null,
        );
        nf++;

        // 国家表（TOP10 完整漏斗）
        for (const r of p.countryTable?.rows ?? []) {
          sCountry.run(
            storeId, periodKey, capturedDate, r.country ?? String(r.country_id ?? '-'), r.country_id ?? null,
            r.statDate ?? null, toNum(r.uv), toNum(r.pv), toNum(r.searchExpPv),
            toNum(r.addcartBuyerCnt), toNum(r.addcartItemQty), toNum(r.wishlistBuyerCnt),
            toNum(r.payItemQty), toNum(r.payBuyerCnt), toNum(r.payConvRate),
            toNum(r.uv__cyc), toNum(r.payItemQty__cyc), toNum(r.payBuyerCnt__cyc), toNum(r.payConvRate__cyc),
          );
          nc++;
        }
      }
    }
  }
  note('fact_store_funnel', nf);
  note('fact_store_country', nc);
}

/** items-raw.json → dim_item / dim_sku / fact_item_snapshot / fact_sku_snapshot */
function importItems(db) {
  const dir = path.join(METRICS, 'raw', 'aliexpress');
  const dItem = db.prepare(`INSERT OR REPLACE INTO dim_item
    (store_id,item_id,title,item_type,item_status,cat_l1,cat_l2,cat_l3,cat_l4,
     first_up_shelf,distribute_channel,image_url,pop_item_id,first_seen_date,last_seen_date)
    VALUES(${Array(15).fill('?').join(',')})`);
  const dSku = db.prepare(`INSERT OR REPLACE INTO dim_sku
    (store_id,item_id,sku_id,goods_id,props,ship_from,sku_type) VALUES(?,?,?,?,?,?,?)`);
  const fItem = db.prepare(`INSERT OR REPLACE INTO fact_item_snapshot
    (captured_date,store_id,item_id,today_sales,recent7d_sales,recent30d_sales,total_sales,
     real_inv,locked_inv,inroad_inv,sellable_qty,pred7d,pred30d,pred60d,pred90d,
     suggest_prepare7d,suggest_prepare14d,suggest_prepare21d,sellable_days,
     supply_price_low,supply_price_high,sold_out_alert,stock_up_recommend)
    VALUES(${Array(23).fill('?').join(',')})`);
  const fSku = db.prepare(`INSERT OR REPLACE INTO fact_sku_snapshot
    (captured_date,store_id,item_id,sku_id,today_sales,recent7d_sales,recent30d_sales,total_sales,
     real_inv,locked_inv,inroad_inv,sellable_qty,pred7d,pred30d,pred60d,pred90d,
     suggest_prepare7d,suggest_prepare14d,suggest_prepare21d,
     supply_price,eff_supply_price,fixed_price,promotion_price,sellable_days,sellable_alert,stock_health)
    VALUES(${Array(26).fill('?').join(',')})`);

  let ni = 0, ns = 0, nf = 0, nk = 0;
  // 扫描 raw/aliexpress/<date>/items-raw.json 与 env-<id>/item-query-page1.json
  for (const dateDir of listDir(dir)) {
    const full = path.join(dir, dateDir, 'items-raw.json');
    const jobs = [];
    if (fs.existsSync(full)) jobs.push({ file: full, storeId: 'env:400370' }); // 全量抓取只覆盖 400370
    for (const sub of listDir(path.join(dir, dateDir))) {
      if (!sub.startsWith('env-')) continue;
      const p1 = path.join(dir, dateDir, sub, 'item-query-page1.json');
      if (fs.existsSync(p1)) jobs.push({ file: p1, storeId: `env:${sub.slice(4)}` });
    }
    const seenItem = new Set();
    for (const job of jobs) {
      const j = readJson(job.file);
      const items = j?.items ?? j?.data?.data?.list ?? [];
      const capturedDate = (j?.capturedAt ?? dateDir).slice(0, 10);
      for (const it of items) {
        if (!it?.itemId) continue;
        const key = `${capturedDate}|${job.storeId}|${it.itemId}`;
        if (seenItem.has(key)) continue; // 全量优先，page1 只补未被覆盖的
        seenItem.add(key);

        const [lo, hi] = parseInterval(it.supplyPriceInterval);
        dItem.run(
          job.storeId, String(it.itemId), toText(it.itemName),
          toNum(it.itemType), toNum(it.itemStatus),
          toText(it.level1CategoryName), toText(it.level2CategoryName),
          toText(it.level3CategoryName), toText(it.level4CategoryName),
          toDate(it.firstUpShelfTime), toText(it.distributeChannel), toText(it.imageUrl),
          toText(it.popItemId), capturedDate, capturedDate,
        );
        ni++;

        fItem.run(
          capturedDate, job.storeId, String(it.itemId),
          toNum(it.todaySalesNum), toNum(it.recent7dSalesNum), toNum(it.recent30dSalesNum), toNum(it.totalSalesNum),
          toNum(it.realWarehouseInventoryNum), toNum(it.lockedInventoryNum), toNum(it.inRoadInventoryNum), toNum(it.sellableQuantity),
          toNum(it.predict7dSalesNum), toNum(it.predict30dSalesNum), toNum(it.predict60dSalesNum), toNum(it.predict90dSalesNum),
          toNum(it.next7dSuggestPrepareGoodsNum), toNum(it.next14dSuggestPrepareGoodsNum), toNum(it.next21dSuggestPrepareGoodsNum),
          toNum(it.sellableDays), lo, hi,
          toBool(it.soldOutAlert), toBool(it.stockUpRecommend),
        );
        nf++;

        for (const s of it.skuList ?? []) {
          if (!s?.skuId) continue;
          dSku.run(job.storeId, String(it.itemId), String(s.skuId), toText(s.goodsId),
            JSON.stringify(s.propertiesDTOList ?? []), toText(s.shipFrom), toNum(s.skuItemType));
          ns++;
          fSku.run(
            capturedDate, job.storeId, String(it.itemId), String(s.skuId),
            toNum(s.todaySalesNum), toNum(s.recent7dSalesNum), toNum(s.recent30dSalesNum), toNum(s.totalSalesNum),
            toNum(s.realWarehouseInventoryNum), toNum(s.lockedInventoryNum), toNum(s.inRoadInventoryNum), toNum(s.sellableQuantity),
            toNum(s.predict7dSalesNum), toNum(s.predict30dSalesNum), toNum(s.predict60dSalesNum), toNum(s.predict90dSalesNum),
            toNum(s.next7dSuggestPrepareGoodsNum), toNum(s.next14dSuggestPrepareGoodsNum), toNum(s.next21dSuggestPrepareGoodsNum),
            toNum(s.supplyPrice), toNum(s.effectiveSupplyPrice), toNum(s.fixedPrice), toNum(s.promotionPrice),
            toNum(s.sellableDays), toBool(s.sellableAlert), toNum(s.skuStockHealthInfo),
          );
          nk++;
        }
      }
    }
  }
  note('dim_item', ni);
  note('dim_sku', ns);
  note('fact_item_snapshot', nf);
  note('fact_sku_snapshot', nk);
}

function importCost(db) {
  const j = readJson(path.join(METRICS, 'facts', 'cost', 'cost-latest.json'));
  if (!j?.costs) { note('fact_cost', 0, { note: 'cost-latest.json 缺失' }); return; }
  const stmt = db.prepare(`INSERT OR REPLACE INTO fact_cost
    (sku_code,price,avg_after,cost_type,confidence,wh,item_code,entry_time,built_at) VALUES(?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const [code, c] of Object.entries(j.costs)) {
    stmt.run(code, toNum(c.price), toNum(c.avgAfter), toText(c.type), toText(c.confidence),
      toText(c.wh), toText(c.code), toText(c.time), toText(j.builtAt));
    n++;
  }
  note('fact_cost', n, { note: `tier=${JSON.stringify(j.tierStat ?? {})}` });
}

/** 极简 CSV 解析（支持引号包裹与内嵌逗号/换行），返回对象数组 */
function parseCsv(text) {
  const s = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch === '\r') { /* skip */ }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c !== '')).map((r) => {
    const o = {};
    header.forEach((h, k) => { o[h] = (r[k] ?? '').trim(); });
    return o;
  });
}

/**
 * SKU 成本桥导入。
 * 默认扫 D:/ecom-translator/output/店铺数据/商品级实收_*.csv（同名取最新日期）。
 * 可用 OPS_COST_BRIDGE_DIR 覆盖目录；找不到就跳过并如实记录（不阻塞建库）。
 */
function importCostBridge(db) {
  const dir = process.env.OPS_COST_BRIDGE_DIR || 'D:/ecom-translator/output/店铺数据';
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^商品级实收_.*\.csv$/.test(f)).sort();
  } catch { /* 目录不存在 */ }
  if (!files.length) { note('dim_sku_cost_bridge', 0, { note: `未找到 ${dir}/商品级实收_*.csv` }); return; }

  const file = files[files.length - 1]; // 日期后缀升序 → 最新
  const builtDate = (file.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] ?? null;
  const rows = parseCsv(fs.readFileSync(path.join(dir, file), 'utf8'));
  const stores = readJson(STORES_PATH)?.stores ?? [];
  const byName = new Map(stores.map((s) => [s.displayName, `env:${s.envId}`]));
  const stmt = db.prepare(`INSERT OR REPLACE INTO dim_sku_cost_bridge
    (platform_sku_id,item_id,store_name,dxm_sku_code,title,revenue90d_cny,settle_count,cost_cny,cost_tier,source_file,built_date)
    VALUES(${Array(11).fill('?').join(',')})`);
  let n = 0, skipped = 0;
  const tiers = {};
  for (const r of rows) {
    const pid = r['平台skuId'];
    if (!pid) { skipped++; continue; }
    tiers[r['成本档'] || '-'] = (tiers[r['成本档'] || '-'] || 0) + 1;
    stmt.run(pid, toText(r['商品ID']), toText(r['店铺']), toText(r['店小秘SKU']), toText(r['商品标题']),
      toNum(r['90天实收CNY']), toNum(r['结算笔数']), toNum(r['采购成本CNY']), toText(r['成本档']),
      file, builtDate);
    n++;
  }
  note('dim_sku_cost_bridge', n, { note: `${file} 成本档=${JSON.stringify(tiers)}${skipped ? ` 跳过无skuId ${skipped}` : ''}` });
}

function importItemProfit(db) {
  const j = readJson(path.join(METRICS, 'facts', 'product-master-20261107.json'));
  if (!j?.stores) { note('fact_item_profit', 0, { note: 'product-master 缺失' }); return; }
  const stmt = db.prepare(`INSERT OR REPLACE INTO fact_item_profit
    (built_date,store_id,item_id,title,category,quality_score,level_desc,dsr,snad_ratio,gmv_rate,
     revenue90d_cny,settle_count,cost_median_cny,penalty_cny,burden_rate_pct,
     est_gross_profit,est_gross_margin,variant_count) VALUES(${Array(18).fill('?').join(',')})`);
  let n = 0;
  for (const [envId, s] of Object.entries(j.stores)) {
    const storeId = `env:${envId}`;
    const builtDate = (j.date ?? '2026-11-07').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    for (const [itemId, it] of Object.entries(s.items ?? {})) {
      stmt.run(builtDate, storeId, itemId, toText(it.title), toText(it.category),
        toNum(it.qualityScore), toText(it.levelCodeDesc), toNum(it.dsr), toNum(it.snadRatio),
        toText(it.gmvRate), toNum(it.revenue90dCNY), toNum(it.settleCount),
        toNum(it.costMedianCNY), toNum(it.penaltyRealCNY), toNum(it.burdenRatePct),
        toNum(it.estGrossProfitCNY), toNum(it.estGrossMarginPct), toNum(it.variantCount));
      n++;
    }
  }
  note('fact_item_profit', n, { note: `built ${j.builtAt ?? '?'}` });
}

function importMarket(db) {
  const dir = path.join(METRICS, 'facts', 'ixspy');
  const stmt = db.prepare(`INSERT OR REPLACE INTO fact_market
    (stat_date,caliber,subject,window,value,meta,captured_at) VALUES(?,?,?,?,?,?,?)`);
  let n = 0;
  for (const f of listDir(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const date = f.replace('.jsonl', '');
    const latest = new Map();
    for (const r of readJsonl(path.join(dir, f))) {
      const k = [r.caliber, r.subject ?? '-', r.window ?? '-'].join('|');
      const prev = latest.get(k);
      if (!prev || String(r.capturedAt ?? '') >= String(prev.capturedAt ?? '')) latest.set(k, r);
    }
    for (const r of latest.values()) {
      if (!r.caliber) continue;
      stmt.run(r.statDate ?? date, r.caliber, r.subject ?? '-', r.window ?? '-',
        r.value === undefined ? null : r.value, JSON.stringify(r.meta ?? {}), r.capturedAt ?? null);
      n++;
    }
  }
  note('fact_market', n);
}

// ═════════════════ 视图（运营问句的固化） ═════════════════

const VIEWS = `
DROP VIEW IF EXISTS v_data_coverage;
CREATE VIEW v_data_coverage AS
  SELECT 'fact_store_daily'   AS tbl, COUNT(*) AS rows, COUNT(DISTINCT stat_date) AS days, MIN(stat_date) AS d_min, MAX(stat_date) AS d_max FROM fact_store_daily
  UNION ALL SELECT 'fact_store_funnel',  COUNT(*), COUNT(DISTINCT captured_date), MIN(captured_date), MAX(captured_date) FROM fact_store_funnel
  UNION ALL SELECT 'fact_store_country', COUNT(*), COUNT(DISTINCT captured_date), MIN(captured_date), MAX(captured_date) FROM fact_store_country
  UNION ALL SELECT 'fact_item_snapshot', COUNT(*), COUNT(DISTINCT captured_date), MIN(captured_date), MAX(captured_date) FROM fact_item_snapshot
  UNION ALL SELECT 'fact_sku_snapshot',  COUNT(*), COUNT(DISTINCT captured_date), MIN(captured_date), MAX(captured_date) FROM fact_sku_snapshot
  UNION ALL SELECT 'fact_item_profit',   COUNT(*), COUNT(DISTINCT built_date),  MIN(built_date),   MAX(built_date)   FROM fact_item_profit
  UNION ALL SELECT 'fact_cost',          COUNT(*), NULL, NULL, NULL FROM fact_cost
  UNION ALL SELECT 'fact_market',        COUNT(*), COUNT(DISTINCT stat_date), MIN(stat_date), MAX(stat_date) FROM fact_market;

-- 增收缺口：把"目标 → 现状 → 缺多少 → 各杠杆要涨多少"一次算清
-- 注意：必须取**每店最新一次**抓取的 Last_30Days，跨日期取 MAX 会混用不同时点的漏斗
DROP VIEW IF EXISTS v_revenue_gap;
CREATE VIEW v_revenue_gap AS
WITH tgt AS (
  SELECT store_id, target_value AS month_target FROM dim_target
   WHERE metric = 'sales.qty.total' AND period = '2026-12'
), cur AS (
  SELECT f.store_id,
         f.pay_item_qty, f.search_exp_pv, f.uv, f.addcart_buyer_cnt, f.pay_buyer_cnt,
         f.pay_conv_rate, f.payqty_per_buyer, f.captured_date AS as_of
    FROM fact_store_funnel f
   WHERE f.period_key = 'Last_30Days'
     AND f.captured_date = (SELECT MAX(captured_date) FROM fact_store_funnel
                             WHERE store_id = f.store_id AND period_key = 'Last_30Days')
)
SELECT s.store_id, s.name, c.as_of,
       t.month_target,
       c.pay_item_qty                                                AS qty_30d,
       ROUND(t.month_target - c.pay_item_qty, 1)                     AS gap_qty,
       ROUND((t.month_target / NULLIF(c.pay_item_qty,0) - 1) * 100, 1) AS gap_pct,
       c.search_exp_pv, c.uv, c.addcart_buyer_cnt, c.pay_buyer_cnt,
       ROUND(c.pay_conv_rate * 100, 2)                               AS conv_pct,
       ROUND(c.payqty_per_buyer, 3)                                  AS items_per_buyer,
       -- 单杠杆所需：只动一个杠杆时的**目标绝对值**（其余两条链路效率不变）
       ROUND(t.month_target / NULLIF(c.pay_item_qty,0), 3)                    AS need_multiplier,
       ROUND(c.search_exp_pv * (t.month_target / NULLIF(c.pay_item_qty,0)), 0) AS need_exp_target,
       ROUND(c.uv * (t.month_target / NULLIF(c.pay_item_qty,0)), 0)            AS need_uv_target,
       ROUND(c.pay_conv_rate * (t.month_target / NULLIF(c.pay_item_qty,0)) * 100, 2) AS need_conv_pct
  FROM dim_store s
  LEFT JOIN tgt t ON t.store_id = s.store_id
  LEFT JOIN cur c ON c.store_id = s.store_id
 WHERE s.enabled = 1;

-- 补货需求：只用物理库存口径（real/locked/inroad），绝不用 sellable_qty
-- 只取每店**最新一次**快照（跨日期未去重会让同一商品报两次）
-- real_inv 有三种语义，必须分开：NULL=非本仓备货 / 0=从不备货 / >0=真实仓存
DROP VIEW IF EXISTS v_restock_need;
CREATE VIEW v_restock_need AS
SELECT f.store_id, f.item_id, i.title, f.captured_date,
       f.real_inv, f.locked_inv, f.inroad_inv,
       f.real_inv - f.locked_inv                            AS available,
       f.recent7d_sales, f.recent30d_sales,
       ROUND(f.recent7d_sales / 7.0, 2)                     AS daily_run_rate_7d,
       ROUND((f.real_inv - f.locked_inv) / NULLIF(f.recent7d_sales / 7.0, 0), 1) AS days_of_cover,
       f.pred7d, f.pred30d,
       f.suggest_prepare7d,
       ROUND(f.supply_price_low, 2)  AS supply_price_low,
       ROUND(f.supply_price_high, 2) AS supply_price_high,
       CASE
         WHEN f.real_inv IS NULL THEN 'NOT_WAREHOUSED'
         -- 实仓 0 却还在出单、且可售额度也是 0 → 数据自相矛盾，不能当断货处理
         WHEN f.real_inv = 0 AND COALESCE(f.sellable_qty,0) = 0 AND COALESCE(f.recent7d_sales,0) > 0 THEN 'DATA_CONFLICT'
         WHEN f.real_inv = 0 AND COALESCE(f.recent7d_sales,0) = 0 THEN 'NO_WAREHOUSE_NO_SALES'
         -- 实仓 0 但平台可售额度充足 → 由平台额度/代发兜底，不属于"本仓断货"
         WHEN f.real_inv = 0 AND COALESCE(f.sellable_qty,0) > 0 THEN 'SUPPLY_BACKED'
         WHEN (f.real_inv - f.locked_inv) <= 0 AND f.recent7d_sales > 0 THEN 'STOCKOUT'
         WHEN f.recent7d_sales > 0 AND (f.real_inv - f.locked_inv) / (f.recent7d_sales / 7.0) < 14 THEN 'URGENT'
         WHEN f.recent7d_sales > 0 AND (f.real_inv - f.locked_inv) / (f.recent7d_sales / 7.0) < 30 THEN 'WATCH'
         -- DEAD_STOCK 原定义：30 日 0 销且仍有实仓积压（>=50 件才是最容易被误清的那批）
         WHEN COALESCE(f.recent30d_sales,0) = 0 AND f.real_inv >= 50 THEN 'DEAD_STOCK'
         WHEN COALESCE(f.recent30d_sales,0) = 0 THEN 'IDLE'
         ELSE 'OK'
       END AS stock_state
  FROM fact_item_snapshot f
  JOIN (SELECT store_id, MAX(captured_date) AS d FROM fact_item_snapshot GROUP BY store_id) latest
    ON latest.store_id = f.store_id AND latest.d = f.captured_date
  LEFT JOIN dim_item i ON i.store_id = f.store_id AND i.item_id = f.item_id;

-- 供货毛利：全托管下你的收入单价是 supply_price，不是前台售价
-- 成本经 dim_sku_cost_bridge 桥接（平台 skuId ↔ 店小秘编码 ↔ 采购成本）
DROP VIEW IF EXISTS v_sku_margin;
CREATE VIEW v_sku_margin AS
SELECT k.store_id, k.item_id, k.sku_id, s.props, i.title,
       k.supply_price, k.fixed_price, k.promotion_price,
       b.cost_cny, b.cost_tier AS cost_confidence, b.dxm_sku_code,
       ROUND(k.supply_price - b.cost_cny, 2)                                          AS gross_unit_cny,
       ROUND((k.supply_price - b.cost_cny) / NULLIF(k.supply_price,0) * 100, 2)       AS gross_margin_pct,
       k.recent7d_sales, k.recent30d_sales,
       k.real_inv, k.locked_inv, k.inroad_inv,
       ROUND(k.supply_price * k.recent30d_sales, 2)                                    AS revenue30d_cny,
       ROUND((k.supply_price - b.cost_cny) * k.recent30d_sales, 2)                     AS grossprofit30d_cny
  FROM fact_sku_snapshot k
  JOIN (SELECT store_id, MAX(captured_date) AS d FROM fact_sku_snapshot GROUP BY store_id) latest
    ON latest.store_id = k.store_id AND latest.d = k.captured_date
  LEFT JOIN dim_sku s ON s.store_id = k.store_id AND s.item_id = k.item_id AND s.sku_id = k.sku_id
  LEFT JOIN dim_item i ON i.store_id = k.store_id AND i.item_id = k.item_id
  LEFT JOIN dim_sku_cost_bridge b ON b.platform_sku_id = k.sku_id;

-- 毛利风险：负毛利/薄毛利但有销量的 SKU —— 运营当天的处理清单
-- 红线：low 档成本是「商品参考价兜底」，且实测存在成本 > 3×供货价的错配，
--        这类行 margin_usable=0，只能拿去核成本，不能拿去下"负毛利"结论
DROP VIEW IF EXISTS v_margin_risk;
CREATE VIEW v_margin_risk AS
SELECT store_id, item_id, sku_id, dxm_sku_code, title,
       supply_price, cost_cny, gross_unit_cny, gross_margin_pct,
       recent7d_sales, recent30d_sales,
       revenue30d_cny, grossprofit30d_cny, cost_confidence,
       CASE WHEN cost_cny > supply_price * 3 THEN 1 ELSE 0 END                        AS cost_suspect,
       CASE WHEN cost_confidence IN ('high','medium') AND cost_cny <= supply_price * 3
            THEN 1 ELSE 0 END                                                          AS margin_usable,
       CASE WHEN cost_cny > supply_price * 3 THEN 'COST_SUSPECT'
            WHEN cost_confidence NOT IN ('high','medium') THEN 'COST_WEAK'
            WHEN gross_margin_pct < 0 THEN 'NEGATIVE'
            WHEN gross_margin_pct < 10 THEN 'THIN'
            WHEN gross_margin_pct < 20 THEN 'LOW'
            ELSE 'OK' END AS margin_state
  FROM v_sku_margin
 WHERE cost_cny IS NOT NULL AND supply_price > 0 AND gross_margin_pct IS NOT NULL;

-- 商品级毛利（商品主数据 90d 估算口径，与 SKU 级供货口径互为交叉校验）
DROP VIEW IF EXISTS v_item_margin;
CREATE VIEW v_item_margin AS
SELECT p.store_id, p.item_id, p.title, p.category,
       p.revenue90d_cny, p.settle_count, p.cost_median_cny,
       p.penalty_cny, p.burden_rate_pct,
       p.est_gross_profit, p.est_gross_margin,
       p.quality_score, p.level_desc, p.dsr, p.snad_ratio, p.gmv_rate,
       ROUND(p.revenue90d_cny / NULLIF(p.settle_count,0), 2) AS unit_revenue_cny,
       CASE WHEN p.est_gross_margin IS NULL THEN 'NO_COST'
            WHEN p.est_gross_margin < 0 THEN 'NEGATIVE'
            WHEN p.est_gross_margin < 15 THEN 'THIN'
            ELSE 'OK' END AS margin_state
  FROM fact_item_profit p;
`;

// ═════════════════ 主流程 ═════════════════

function main() {
  fs.mkdirSync(METRICS, { recursive: true });
  if (REBUILD && fs.existsSync(DB_PATH)) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + suffix); } catch { /* ignore */ }
    }
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(DDL);

  const t0 = Date.now();
  db.exec('BEGIN');
  try {
    importMeta(db);
    importStores(db);
    importCalibers(db);
    importTargets(db);
    importStoreDaily(db);
    importFunnel(db);
    importItems(db);
    importCost(db);
    importCostBridge(db);
    importItemProfit(db);
    importMarket(db);
    db.exec(VIEWS);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('建库失败，已回滚：', e.message);
    console.error(e.stack);
    process.exit(1);
  }

  const coverage = db.prepare('SELECT * FROM v_data_coverage').all();
  const gap = db.prepare('SELECT * FROM v_revenue_gap').all();
  const sizeKb = Math.round(fs.statSync(DB_PATH).size / 1024);

  if (AS_JSON) {
    console.log(JSON.stringify({ db: path.relative(ROOT, DB_PATH), sizeKb, ms: Date.now() - t0, stats, coverage, gap }, null, 2));
    db.close();
    return;
  }

  console.log(`\n运营分析库 ${path.relative(ROOT, DB_PATH)}  (${sizeKb} KB, ${Date.now() - t0} ms)${REBUILD ? ' [REBUILD]' : ''}\n`);
  console.log('导入明细：');
  for (const l of log) console.log(l);
  console.log('\n数据覆盖度：');
  console.log('  ' + 'table'.padEnd(22) + 'rows'.padStart(8) + '  days  range');
  for (const c of coverage) {
    console.log('  ' + String(c.tbl).padEnd(22) + String(c.rows).padStart(8) + '  ' +
      String(c.days ?? '-').padStart(4) + '  ' + (c.d_min ? `${c.d_min} ~ ${c.d_max}` : '-'));
  }
  if (gap.length) {
    console.log('\n增收缺口（2026-12 目标 vs 最近一次漏斗抓取）：');
    for (const g of gap) {
      if (g.qty_30d == null) { console.log(`  ${g.name}: 无漏斗数据`); continue; }
      console.log(`  ${g.name}  as_of ${g.as_of}`);
      if (g.month_target == null) {
        console.log(`     现状 ${g.qty_30d} 件/30d（未设 2026-12 目标）`);
      } else {
        console.log(`     目标 ${g.month_target} 件/月 · 现状 ${g.qty_30d} 件/30d · 缺 ${g.gap_qty} 件 (${g.gap_pct}%)`);
      }
      console.log(`     曝光 ${g.search_exp_pv} → 访客 ${g.uv} → 加购 ${g.addcart_buyer_cnt} → 买家 ${g.pay_buyer_cnt} → 件数 ${g.qty_30d}（转化 ${g.conv_pct}% 客单 ${g.items_per_buyer}）`);
      if (g.need_multiplier) {
        console.log(`     单杠杆目标：需曝光 ${g.need_exp_target} 或 访客 ${g.need_uv_target} 或 转化率 ${g.need_conv_pct}%（任选其一，其余不变）`);
      }
    }
  }
  db.close();
}

main();
