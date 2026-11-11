#!/usr/bin/env node
/**
 * D4 · 商品级补货计划（只读计算，不写库、不下单）
 *
 * 为什么需要它：workflow 的输入是**单 SKU**，而 C2 的 facts 只有 STORE 聚合。
 * 直接用整店聚合跑出来的 2877 件无法下单（不是某个 SKU 的量）。
 * 商品级三要素在 item-query 的原始响应里，这里把它们抽出来逐个算。
 *
 * 口径红线：
 *   · 物理可用 = realWarehouseInventoryNum − lockedInventoryNum（**不用 sellableQuantity**，
 *     那是平台可售额度，不是物理库存，boundary 会直接拒）
 *   · 在途 = inRoadInventoryNum
 *   · 销量 = recent7dSalesNum（配 window=7）或 recent30dSalesNum（配 window=30）
 *
 * 用法：node scripts/plan-restock.mjs [--env 400370] [--window 7] [--date 2026-11-10] [--source full|page1] [--json]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const { runOne } = await imp("agents/purchase-inventory/src/engine.js");
const { loadLimits } = await imp("agents/purchase-inventory/src/limits.js");

const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const ENV = val("env", "400370");
const WIN = Number(val("window", "7"));
const AS_JSON = argv.includes("--json");
const DATE = val("date", (() => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10))());
const SOURCE = val("source", "full"); // full=全量 items-raw.json；page1=item-query-page1.json

// 数据源解析顺序（多店共用目录，路径必须带店号）：
//   ① <date>/env-<ENV>/items-raw.json   分店全量（权威）
//   ② <date>/items-raw.json             旧版**非隔离**路径：须用本店 page1 做 itemId 交集验证归属，
//                                        零交集一律拒绝（2026-11-10 曾把 461693 的全量误当 400370）
//   ③ <date>/env-<ENV>/item-query-page1.json  仅第 1 页，最后兜底
const SCOPED_FULL = path.join(ROOT, `data/metrics/raw/aliexpress/${DATE}/env-${ENV}/items-raw.json`);
const LEGACY_FULL = path.join(ROOT, `data/metrics/raw/aliexpress/${DATE}/items-raw.json`);
const P1_PATH = path.join(ROOT, `data/metrics/raw/aliexpress/${DATE}/env-${ENV}/item-query-page1.json`);

async function readJsonSafe(p) {
  try { return { ok: true, data: JSON.parse(await readFile(p, "utf8")) }; }
  catch (e) { return { ok: false, err: e.message, p }; }
}

// 旧版根文件归属校验：与本店 page1 至少 1 个 itemId 重合才认
async function legacyBelongsToEnv(file) {
  const a = await readJsonSafe(file);
  const b = await readJsonSafe(P1_PATH);
  if (!a.ok) return { ok: false, reason: a.err };
  if (!b.ok) return { ok: false, reason: "缺少本店 page1，无法验证归属" };
  const items = a.data.items ?? [];
  const p1 = b.data?.data?.data?.list ?? b.data.items ?? [];
  if (!p1.length) return { ok: false, reason: "本店 page1 为空，无法验证归属" };
  const set = new Set(p1.map((x) => String(x.itemId)));
  const ov = items.filter((x) => set.has(String(x.itemId))).length;
  if (ov > 0) return { ok: true, overlap: ov };
  return { ok: false, reason: `与本店 page1 零交集(0/${p1.length})，疑似他店数据` };
}

let data, srcLabel, SRC_PATH;
const _scoped = SOURCE !== "page1" ? await readJsonSafe(SCOPED_FULL) : { ok: false };
if (_scoped.ok) {
  data = _scoped.data; srcLabel = "full-scoped"; SRC_PATH = SCOPED_FULL;
} else if (SOURCE !== "page1" && (await readJsonSafe(LEGACY_FULL)).ok) {
  const verdict = await legacyBelongsToEnv(LEGACY_FULL);
  if (!verdict.ok) {
    console.error(`拒绝使用旧版根 items-raw.json：${verdict.reason}\n  ${LEGACY_FULL}\n请改用分店路径 env-${ENV}/items-raw.json（重新抓取即可生成）。`);
    process.exit(2);
  }
  data = (await readJsonSafe(LEGACY_FULL)).data; srcLabel = "full-legacy"; SRC_PATH = LEGACY_FULL;
} else {
  const _p1 = await readJsonSafe(P1_PATH);
  if (!_p1.ok) {
    console.error("找不到商品数据源:\n  " + SCOPED_FULL + "\n  " + P1_PATH);
    process.exit(2);
  }
  data = _p1.data; srcLabel = "page1"; SRC_PATH = P1_PATH;
}
const useFull = srcLabel.startsWith("full");
const list = useFull ? (data.items ?? []) : (data?.data?.data?.list ?? []);
const SRC_KIND = srcLabel;
const DECLARED_TOTAL = useFull ? (data.total ?? null) : null;
if (!list.length) { console.error("商品数据源为空:", SRC_PATH); process.exit(2); }

const limits = await loadLimits();
const now = new Date().toISOString();
const rows = [];

for (const it of list) {
  const real = Number(it.realWarehouseInventoryNum ?? NaN);
  const locked = Number(it.lockedInventoryNum ?? 0);
  if (!Number.isFinite(real)) continue;
  const physical = real - locked;
  const transit = Number(it.inRoadInventoryNum ?? 0);
  const sales = Number((WIN === 30 ? it.recent30dSalesNum : it.recent7dSalesNum) ?? NaN);
  if (!Number.isFinite(sales)) continue;

  const r = await runOne({
    asOf: now,
    skuId: String(it.itemId),
    historyDays: WIN,
    params: { window: WIN },
    transitCollectedAt: now,
    calibers: {
      "inventory.actual": real,
      "inventory.occupied": locked,
      "inventory.transit": transit,
      "sales.qty.total": sales,
    },
  }, limits);

  // runOne 顶层就有 verdict / dailyVelocity / coverDays / rawSuggestQty / suggestQty / splitInto。
  rows.push({
    itemId: String(it.itemId),
    name: String(it.itemName ?? "").slice(0, 26),
    physical, transit, sales,
    status: r.status,
    verdict: r.verdict ?? r.code ?? null,
    dailyVelocity: r.dailyVelocity != null ? Number(Number(r.dailyVelocity).toFixed(2)) : null,
    coverDays: r.coverDays != null ? Number(Number(r.coverDays).toFixed(1)) : null,
    rawSuggestQty: Number(r.rawSuggestQty ?? 0),
    suggestQty: Number(r.suggestQty ?? 0),
    splitInto: Number(r.splitInto ?? 1),
  });
}

const restock = rows.filter((x) => x.verdict === "RESTOCK");
const total = restock.reduce((s, x) => s + x.suggestQty, 0);
const maxTotal = limits.quantity.maxTotalPerOrder;

if (AS_JSON) {
  console.log(JSON.stringify({ env: ENV, window: WIN, rows, total, maxTotal }, null, 2));
} else {
  const coverageNote = SRC_KIND === "full" && DECLARED_TOTAL
    ? `（全量 ${list.length}/${DECLARED_TOTAL} ${data.coverage ?? ""}）`
    : `（${SRC_KIND}${SRC_KIND === "page1" ? " · 仅第1页9商品" : ""}）`;
  console.log(`店 ${ENV} · 窗口 ${WIN}d · 商品 ${rows.length} 个${coverageNote} · 源 ${path.basename(SRC_PATH)}\n`);
  console.log(`${"itemId".padEnd(18)}${"名称".padEnd(28)}${"可用".padStart(6)}${"在途".padStart(6)}${"销量".padStart(6)}${"日均".padStart(7)}${"覆盖".padStart(8)}${"建议".padStart(7)}${"拆单".padStart(6)}  结论`);
  for (const x of rows) {
    console.log(
      `${x.itemId.padEnd(18)}${x.name.padEnd(28)}${String(x.physical).padStart(6)}${String(x.transit).padStart(6)}` +
      `${String(x.sales).padStart(6)}${String(x.dailyVelocity ?? "-").padStart(7)}${String(x.coverDays ?? "-").padStart(8)}` +
      `${String(x.suggestQty).padStart(7)}${String(x.splitInto).padStart(6)}  ${x.verdict}${x.status !== "OK" ? `(${x.status})` : ""}`,
    );
  }
  console.log(`\n需补货 SKU：${restock.length} 个，合计 ${total} 件（单批上限 ${maxTotal}）`);
  if (total > maxTotal) {
    const n = Math.ceil(total / maxTotal);
    console.log(`→ 需分 ${n} 批下单：` + Array.from({ length: n }, (_, i) =>
      Math.min(maxTotal, total - i * maxTotal)).join(" + ") + ` = ${total} 件`);
  } else {
    console.log(`→ 单批可下（${total} ≤ ${maxTotal}）`);
  }
  console.log("\n⚠ 本表只读计算，不生成采购单、不碰平台；下单仍需人工在店小秘/采购系统执行。");
}
