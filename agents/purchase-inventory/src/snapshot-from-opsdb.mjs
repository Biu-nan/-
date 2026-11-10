#!/usr/bin/env node
// agents/purchase-inventory/src/snapshot-from-opsdb.mjs
// 把运营分析库 data/metrics/ops.db 的真实库存/销量，桥接成采购库存 Agent 的采集快照。
//
// 存在的理由：D2 之前只吃「注入的 --snapshot」，没有真实数据源（等 C2）。而 ops.db
// 已含每 SKU 的实仓/占用/在途/30d 销量（来自 sales.query），无需等平台采集接线即可
// 用真实数据跑通一次 —— 这正是 D4「真实跑通一次」缺的那块。
//
// 口径映射（严格按 contract.md §2，只认这 4 个口径，绝不碰 inventory.sellable）：
//   inventory.actual   ← real_inv      （实仓在库）
//   inventory.occupied ← locked_inv    （已被订单占用）
//   inventory.transit  ← inroad_inv    （已发往平台仓、未入库）
//   sales.qty.total    ← recent30d_sales（含货通，件数口径）
//   sellable_qty 只读进 _meta 供审计，绝不参与计算（平台可售额度 ≠ 物理库存）。
//
// 用法：
//   # 单 SKU 快照（给 --workflow 用）
//   node .../snapshot-from-opsdb.mjs --store 400370 --sku 12000057579334742 [--out snap.json]
//   # 全店聚合快照（给 --workflow 用，看整店该不该补）
//   node .../snapshot-from-opsdb.mjs --store 400370 --aggregate [--out snap.json]
//   # 全店逐 SKU 批量评估，打印真实补货清单（业务主产物）
//   node .../snapshot-from-opsdb.mjs --store 400370 --batch [--top 20] [--out list.json]
//
// 退出码：0 正常 / 2 参数或数据错误

import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOne } from "./engine.js";
import { loadLimits } from "./limits.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", ".."); // agents/purchase-inventory/src → 仓库根
const OPS_DB = path.join(ROOT, "data", "metrics", "ops.db");

// ── 口径窗口：用 30d 销量 / 30 天，日销速 = recent30d_sales/30 ──
// 选 30 而非 14：ops.db 的销量口径本身就是 30d（sales.query 只给 today/7d/30d），
// 用 14 会把假的窗口数塞进真数据。historyDays 同口径取 30（推定，非真实上架天数，见 _meta.assumptions）。
const WINDOW_DAYS = 30;
const HISTORY_DAYS = 30;

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);

function die(msg) {
  console.error(`[snapshot-from-opsdb] ${msg}`);
  process.exit(2);
}

// 兼容 "400370" 与 "env:400370"
function normalizeStore(s) {
  if (!s) die("必须给 --store");
  return String(s).startsWith("env:") ? String(s) : `env:${s}`;
}

function openDb() {
  try {
    readFileSync(OPS_DB); // 先探存在，避免 sqlite 报错信息含糊
  } catch {
    die(`找不到运营分析库：${OPS_DB}（先跑 node scripts/build-ops-db.mjs --rebuild）`);
  }
  return new DatabaseSync(OPS_DB, { readOnly: true });
}

function latestDate(db, storeId) {
  const row = db.prepare(
    "SELECT MAX(captured_date) d FROM fact_sku_snapshot WHERE store_id = ?",
  ).get(storeId);
  if (!row?.d) die(`${storeId} 在 fact_sku_snapshot 中没有任何快照`);
  return row.d;
}

// 数字容错：null/undefined/非数字 → 0；负值→0（防御脏数据，但不掩盖：负值本不应出现）
const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

// 一条 SKU 行 → calibers（严格 4 口径）
function calibersOf(row) {
  return {
    "inventory.actual": n(row.real_inv),
    "inventory.occupied": n(row.locked_inv),
    "inventory.transit": n(row.inroad_inv),
    "sales.qty.total": n(row.recent30d_sales),
  };
}

function snapshotFromRow(row, { storeId, date, skuId }) {
  const cal = calibersOf(row);
  return {
    storeId: storeId.replace(/^env:/, ""),
    asOf: `${date}T12:00:00+08:00`, // 12:00 避开 15–17 点日切窗口
    collectedAt: `${date}T11:58:00+08:00`, // 快照采集时刻，滞后 2 分钟 < 60，不触 TRANSIT_STALE
    calibers: cal,
    historyDays: HISTORY_DAYS,
    cumulativeSalesBefore30d: Math.max(0, n(row.total_sales) - n(row.recent30d_sales)),
    params: { window: WINDOW_DAYS },
    skuId,
    _meta: {
      source: "ops.db/fact_sku_snapshot",
      captured_date: date,
      assumptions: [
        "historyDays=30 由 30d 销售口径推定，非真实上架天数",
        "sales.qty.total 取 recent30d_sales（含货通，件数口径）",
      ],
      sellable_qty_not_used: n(row.sellable_qty),
      sellable_note: "平台可售额度，只入审计不入计算（contract.md §2.1）",
    },
  };
}

function writeOut(obj, outPath) {
  const text = JSON.stringify(obj, null, 2);
  if (outPath) {
    writeFileSync(outPath, text, "utf8");
    console.log(`已写: ${path.relative(ROOT, outPath)}`);
  }
  return text;
}

async function main() {
  const storeId = normalizeStore(arg("--store"));
  const db = openDb();
  const date = arg("--date") || latestDate(db, storeId);

  // ── 单 SKU ──
  if (has("--sku") || arg("--sku")) {
    const sku = arg("--sku");
    const row = db.prepare(
      "SELECT * FROM fact_sku_snapshot WHERE store_id = ? AND captured_date = ? AND sku_id = ?",
    ).get(storeId, date, sku);
    if (!row) die(`${storeId} ${date} 无此 SKU：${sku}`);
    const snap = snapshotFromRow(row, { storeId, date, skuId: sku });
    if (!has("--out")) console.log(writeOut(snap, null));
    else writeOut(snap, arg("--out"));
    db.close();
    return;
  }

  // ── 全店聚合（看整店该不该补）──
  if (has("--aggregate")) {
    const agg = db.prepare(
      `SELECT SUM(real_inv) real_inv, SUM(locked_inv) locked_inv, SUM(inroad_inv) inroad_inv,
              SUM(recent30d_sales) recent30d_sales, SUM(total_sales) total_sales, SUM(sellable_qty) sellable_qty
         FROM fact_sku_snapshot WHERE store_id = ? AND captured_date = ?`,
    ).get(storeId, date);
    const snap = snapshotFromRow(agg, { storeId, date, skuId: undefined });
    if (!has("--out")) console.log(writeOut(snap, null));
    else writeOut(snap, arg("--out"));
    db.close();
    return;
  }

  // ── 批量：逐 SKU 真实评估，打印补货清单（默认）──
  const limits = await loadLimits();
  const rows = db.prepare(
    "SELECT * FROM fact_sku_snapshot WHERE store_id = ? AND captured_date = ?",
  ).all(storeId, date);
  db.close();
  if (!rows.length) die(`${storeId} ${date} 无 SKU 数据`);

  const summary = { restock: 0, watch: 0, overstock: 0, deadStock: 0, noHistory: 0 };
  const rejected = [];
  const restockItems = [];
  const asOf = `${date}T12:00:00+08:00`;

  for (const row of rows) {
    const cal = calibersOf(row);
    const input = {
      skuId: row.sku_id,
      asOf,
      calibers: cal,
      historyDays: HISTORY_DAYS,
      cumulativeSalesBefore30d: Math.max(0, n(row.total_sales) - n(row.recent30d_sales)),
      transitCollectedAt: `${date}T11:58:00+08:00`,
      params: { window: WINDOW_DAYS },
    };
    const r = await runOne(input, limits);
    if (r.status !== "OK") {
      rejected.push({ skuId: row.sku_id, code: r.code });
      continue;
    }
    // runOne 成功时把 verdict/覆盖天/建议量放在顶层（见 engine.js return），不在 r.items
    const key = { RESTOCK: "restock", WATCH: "watch", OVERSTOCK: "overstock", DEAD_STOCK: "deadStock", NO_HISTORY: "noHistory" };
    const verdict = r.verdict;
    summary[key[verdict]] = (summary[key[verdict]] ?? 0) + 1;
    if (verdict === "RESTOCK") {
      restockItems.push({
        skuId: row.sku_id,
        itemId: row.item_id,
        physicalAvailable: r.physicalAvailable,
        dailyVelocity: Number(r.dailyVelocity.toFixed(2)),
        coverDays: Number(r.coverDays.toFixed(1)),
        suggestQty: r.suggestQty,
      });
    }
  }

  restockItems.sort((a, b) => b.suggestQty - a.suggestQty);
  const totalSuggest = restockItems.reduce((s, x) => s + x.suggestQty, 0);
  const topN = Number(arg("--top", 20));

  const result = {
    storeId: storeId.replace(/^env:/, ""),
    captured_date: date,
    asOf,
    window: WINDOW_DAYS,
    historyDays: HISTORY_DAYS,
    skuTotal: rows.length,
    evaluated: rows.length - rejected.length,
    rejected: { count: rejected.length, sample: rejected.slice(0, 5) },
    summary,
    totalSuggestQty: totalSuggest,
    restockTop: restockItems.slice(0, topN),
  };

  console.log(`\n# 真实补货评估 · ${storeId} · ${date}（window=${WINDOW_DAYS}d）`);
  console.log(`  SKU 总数 ${rows.length}，可评估 ${result.evaluated}，口径拒绝 ${rejected.length}`);
  console.log(`  结论分布: RESTOCK ${summary.restock} · WATCH ${summary.watch} · OVERSTOCK ${summary.overstock} · DEAD_STOCK ${summary.deadStock} · NO_HISTORY ${summary.noHistory}`);
  console.log(`  需补货 SKU ${restockItems.length} 个，合计建议 ${totalSuggest} 件\n`);
  console.log("  skuId            | 物理可用 | 日销速 | 覆盖天 | 建议补");
  for (const it of restockItems.slice(0, topN)) {
    console.log(`  ${String(it.skuId).padEnd(16)} | ${String(it.physicalAvailable).padStart(8)} | ${String(it.dailyVelocity).padStart(6)} | ${String(it.coverDays).padStart(6)} | ${it.suggestQty}`);
  }
  if (rejected.length) {
    console.log(`\n  ⚠️ 口径拒绝 ${rejected.length} 个（多为 占用>实仓 脏数据）：`);
    for (const r of rejected.slice(0, 5)) console.log(`    ${r.skuId} → ${r.code}`);
  }
  const out = arg("--out");
  if (out) writeOut(result, out);
}

main().catch((e) => {
  console.error(`FATAL ${e.code ?? ""} ${e.message}`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(2);
});
