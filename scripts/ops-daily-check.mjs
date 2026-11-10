#!/usr/bin/env node
// 运营日巡检器（只读，不改数据）
//
// 把 docs/OPS_DATA_ASSET_2026-11-10.md §5.3 的自洽校验 + §5.2 的告警分级固化成可执行检查。
// 设计原则：先验数据、再看业务 —— 数据校验 FAIL 时**不输出业务结论**（fail-closed）。
//
// 用法：
//   node scripts/ops-daily-check.mjs                # 人读报告
//   node scripts/ops-daily-check.mjs --json         # 机器可读
//   node scripts/ops-daily-check.mjs --store env:416488
//
// 退出码：0=无 P0；1=有 P0（断货/负毛利）；2=数据校验 FAIL（此时业务结论不可信）

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB = path.join(ROOT, 'data', 'metrics', 'ops.db');
const AS_JSON = process.argv.includes('--json');
const storeArg = (() => {
  const i = process.argv.indexOf('--store');
  return i > -1 ? process.argv[i + 1] : null;
})();

if (!fs.existsSync(DB)) {
  console.error(`找不到 ${path.relative(ROOT, DB)}，先跑：node scripts/build-ops-db.mjs`);
  process.exit(2);
}

const db = new DatabaseSync(DB);
const q = (sql, ...p) => db.prepare(sql).all(...p);
const g = (sql, ...p) => db.prepare(sql).get(...p);
const where = storeArg ? 'AND store_id = ?' : '';
const wargs = storeArg ? [storeArg] : [];

// ─────────── 1. 数据校验（FAIL 则停止业务解读） ───────────

const checks = [];

// 1.1 商品级 vs SKU 级销量加总
{
  const r = g(`SELECT
      (SELECT SUM(recent30d_sales) FROM fact_item_snapshot WHERE captured_date = (SELECT MAX(captured_date) FROM fact_item_snapshot) ${where}) i,
      (SELECT SUM(recent30d_sales) FROM fact_sku_snapshot  WHERE captured_date = (SELECT MAX(captured_date) FROM fact_sku_snapshot)  ${where}) s`,
    ...wargs, ...wargs);
  const ok = r && r.i !== null && r.i === r.s;
  checks.push({ id: 'item_vs_sku_qty', name: '商品级与SKU级30d销量加总一致', status: ok ? 'PASS' : 'FAIL',
    detail: `item=${r?.i ?? 'null'} sku=${r?.s ?? 'null'}` });
}

// 1.2 库存字段量级（sellable 是额度，不应接近实仓）
{
  const r = g(`SELECT SUM(sellable_qty) s, SUM(real_inv) r FROM fact_item_snapshot
                WHERE captured_date = (SELECT MAX(captured_date) FROM fact_item_snapshot) ${where}`, ...wargs);
  if (r?.r) {
    const ratio = r.s / r.r;
    checks.push({ id: 'sellable_vs_real', name: '可售额度 vs 实仓量级（防误用字段）', status: ratio > 3 ? 'PASS' : 'WARN',
      detail: `sellable=${r.s} real=${r.r} 比值=${ratio.toFixed(1)}x ${ratio > 3 ? '（确认 sellable 为平台额度，禁当库存）' : '（异常接近，检查是否抓错字段）'}` });
  } else {
    checks.push({ id: 'sellable_vs_real', name: '可售额度 vs 实仓量级', status: 'WARN', detail: '无库存数据' });
  }
}

// 1.3 成本异常
{
  const r = g(`SELECT COUNT(*) n FROM v_margin_risk WHERE cost_suspect = 1`);
  checks.push({ id: 'cost_suspect', name: '成本异常值（cost > 3×供货价）', status: r.n > 0 ? 'WARN' : 'PASS',
    detail: `${r.n} 个 SKU 需核成本口径（多为N件装整包价），不下毛利结论` });
}

// 1.4 平台两套口径差（按店比，避免取到 pop 店的 FETCH_MISS 空值行）
{
  const cmpStore = storeArg || 'env:400370';
  const a = g(`SELECT value, stat_date FROM fact_store_daily
                WHERE caliber='sales.qty.total' AND window='30d' AND store_id = ? AND value IS NOT NULL
                ORDER BY stat_date DESC LIMIT 1`, cmpStore);
  const b = g(`SELECT pay_item_qty v, captured_date FROM fact_store_funnel
                WHERE period_key='Last_30Days' AND store_id = ?
                ORDER BY captured_date DESC LIMIT 1`, cmpStore);
  if (a?.value != null && b?.v != null) {
    const diff = Math.abs(a.value - b.v) / b.v * 100;
    checks.push({ id: 'caliber_gap', name: '销售管理 vs 生意参谋 30d 口径差', status: diff < 5 ? 'PASS' : 'WARN',
      detail: `${cmpStore} sales.query=${a.value}(${a.stat_date}) store-overview=${b.v}(${b.captured_date}) 差 ${diff.toFixed(1)}%（报告须声明用哪套）` });
  } else {
    checks.push({ id: 'caliber_gap', name: '两套口径交叉校验', status: 'WARN',
      detail: `${cmpStore} 缺一侧数据（sales.query=${a?.value ?? '无'} / store-overview=${b?.v ?? '无'}）` });
  }
}

// 1.5 数据新鲜度（最新快照日期距今天数）
{
  const r = g(`SELECT MAX(d) d FROM (
      SELECT MAX(stat_date) d FROM fact_store_daily
      UNION ALL SELECT MAX(captured_date) FROM fact_store_funnel
      UNION ALL SELECT MAX(captured_date) FROM fact_item_snapshot)`);
  const days = r?.d ? Math.floor((Date.now() - new Date(r.d + 'T00:00:00+08:00').getTime()) / 86400000) : null;
  checks.push({ id: 'freshness', name: '数据新鲜度', status: days == null ? 'FAIL' : days <= 2 ? 'PASS' : days <= 7 ? 'WARN' : 'FAIL',
    detail: days == null ? '无数据' : `最新 ${r.d}，距今 ${days} 天${days > 2 ? '（超过 2 天，趋势结论失效）' : ''}` });
}

const dataFailed = checks.some((c) => c.status === 'FAIL');

// ─────────── 2. 业务告警（数据 FAIL 时跳过） ───────────

const alerts = [];
if (!dataFailed) {
  // P0 断货 / P1 补货紧急 / P2 滞销
  for (const r of q(`SELECT store_id, item_id, title, real_inv, locked_inv, days_of_cover, stock_state, recent7d_sales
                       FROM v_restock_need WHERE stock_state IN ('STOCKOUT','URGENT','DEAD_STOCK')
                        ${storeArg ? 'AND store_id = ?' : ''}
                      ORDER BY CASE stock_state WHEN 'STOCKOUT' THEN 1 WHEN 'URGENT' THEN 2 ELSE 3 END, days_of_cover`, ...wargs)) {
    const level = r.stock_state === 'STOCKOUT' ? 'P0' : r.stock_state === 'URGENT' ? 'P1' : 'P2';
    alerts.push({ level, kind: r.stock_state, store: r.store_id, subject: r.item_id,
      detail: `实仓${r.real_inv} 占用${r.locked_inv} 可售${(r.real_inv ?? 0) - (r.locked_inv ?? 0)} 覆盖${r.days_of_cover ?? '-'}天 7d销${r.recent7d_sales}`,
      title: r.title });
  }

  // P0 负毛利且有量（只信可信成本）
  for (const r of q(`SELECT store_id, item_id, dxm_sku_code, gross_margin_pct, grossprofit30d_cny, recent30d_sales
                       FROM v_margin_risk
                      WHERE margin_usable = 1 AND margin_state IN ('NEGATIVE','THIN') AND recent30d_sales > 0
                        ${storeArg ? 'AND store_id = ?' : ''}
                      ORDER BY grossprofit30d_cny ASC LIMIT 20`, ...wargs)) {
    alerts.push({ level: r.margin_state === 'NEGATIVE' ? 'P0' : 'P1', kind: 'MARGIN_' + r.margin_state,
      store: r.store_id, subject: r.dxm_sku_code || r.item_id,
      detail: `毛利率 ${r.gross_margin_pct}% · 30d ${r.recent30d_sales}件 · 毛利 ¥${r.grossprofit30d_cny}` });
  }

  // P1 转化骤降
  for (const r of q(`SELECT store_id, period_key, pay_conv_rate, cyc_pay_conv_rate, pay_item_qty, captured_date
                       FROM fact_store_funnel
                      WHERE cyc_pay_conv_rate IS NOT NULL AND cyc_pay_conv_rate < -0.20
                        ${storeArg ? 'AND store_id = ?' : ''}
                      ORDER BY captured_date DESC`, ...wargs)) {
    alerts.push({ level: 'P1', kind: 'CONV_DROP', store: r.store_id, subject: r.period_key,
      detail: `转化率 ${(r.pay_conv_rate * 100).toFixed(2)}% 环比 ${(r.cyc_pay_conv_rate * 100).toFixed(1)}% · 件数${r.pay_item_qty} · ${r.captured_date}` });
  }

  // P1 断码率
  for (const r of q(`SELECT a.store_id, a.value broken, b.value total,
                            ROUND(a.value * 100.0 / NULLIF(b.value,0), 2) pct
                       FROM fact_store_daily a
                       JOIN fact_store_daily b
                         ON b.store_id = a.store_id AND b.stat_date = a.stat_date
                        AND b.caliber = 'catalog.platformItems' AND b.window = a.window
                      WHERE a.caliber = 'catalog.brokenSize'
                        ${storeArg ? 'AND a.store_id = ?' : ''}`, ...wargs)) {
    if (r.pct != null && r.pct > 5) {
      alerts.push({ level: r.pct > 10 ? 'P1' : 'P2', kind: 'BROKEN_SIZE', store: r.store_id, subject: 'STORE',
        detail: `断码 ${r.broken}/${r.total} = ${r.pct}%（schema 阈值 warn 5% / critical 10%）` });
    }
  }
}

const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
alerts.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));

// ─────────── 3. 输出 ───────────

const coverage = q('SELECT * FROM v_data_coverage');
const gap = q('SELECT * FROM v_revenue_gap' + (storeArg ? ' WHERE store_id = ?' : ''), ...wargs);
const hasP0 = alerts.some((a) => a.level === 'P0');

if (AS_JSON) {
  console.log(JSON.stringify({ at: new Date().toISOString(), store: storeArg, checks, dataFailed, alerts, coverage, gap }, null, 2));
  db.close();
  process.exit(dataFailed ? 2 : hasP0 ? 1 : 0);
}

console.log(`\n运营日巡检 · ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}${storeArg ? ` · ${storeArg}` : ' · 全店'}\n`);

console.log('【1】数据校验');
for (const c of checks) {
  const mark = c.status === 'PASS' ? '✅' : c.status === 'WARN' ? '⚠️ ' : '❌';
  console.log(`  ${mark} ${c.name.padEnd(28)} ${c.detail}`);
}
if (dataFailed) {
  console.log('\n  ❌ 数据校验未通过 → 不输出业务结论。先修数据，避免在错数上做决策。\n');
  db.close();
  process.exit(2);
}

console.log('\n【2】业务告警');
if (!alerts.length) {
  console.log('  ✅ 无告警（P0 断货 / 负毛利 / 转化骤降 均未触发）');
} else {
  const byLevel = { P0: [], P1: [], P2: [] };
  for (const a of alerts) (byLevel[a.level] ||= []).push(a);
  for (const lv of ['P0', 'P1', 'P2']) {
    if (!byLevel[lv]?.length) continue;
    console.log(`  ${lv}（${byLevel[lv].length}）`);
    for (const a of byLevel[lv].slice(0, 15)) {
      console.log(`    · [${a.kind}] ${a.store} ${a.subject}  ${a.detail}`);
    }
    if (byLevel[lv].length > 15) console.log(`    … 另有 ${byLevel[lv].length - 15} 条`);
  }
}

console.log('\n【3】覆盖度');
for (const c of coverage) {
  console.log(`  ${String(c.tbl).padEnd(22)} ${String(c.rows).padStart(7)} 行  ${c.d_min ? `${c.d_min} ~ ${c.d_max}` : ''}`);
}

console.log('\n【4】增收缺口');
for (const r of gap) {
  if (r.qty_30d == null) continue;
  const tgt = r.month_target != null ? `目标 ${r.month_target} / 缺 ${r.gap_qty} (${r.gap_pct}%)` : '未设目标';
  console.log(`  ${r.name.padEnd(18)} 现状 ${r.qty_30d} 件/30d · ${tgt} · 转化 ${r.conv_pct}%`);
}

console.log('');
db.close();
process.exit(hasP0 ? 1 : 0);
