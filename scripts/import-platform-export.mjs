#!/usr/bin/env node
// scripts/import-platform-export.mjs
// C2b-B：把速卖通后台导出的「按日」报表导入，补齐 11/1–11/9 等历史（每日累积补不了的那段）。
//
// 归一化目标：data/metrics/facts/platform-export/<statDate>.jsonl
//   —— 与 build-ops-db.mjs 的 importStoreDaily 消费格式一致；随后跑
//      node scripts/build-ops-db.mjs --rebuild 即并入 fact_store_daily。
//   —— 必须按日期分文件：importStoreDaily 的去重键是 caliber|store|subject|window（不含日期），
//      多日塞一个文件会被压成一条。
//
// 两种输入：
//   1) 长表（推荐，最稳）：列 = date,caliber,value[,window][,store]
//        2026-11-01,sales.qty.total,2100,30d
//        2026-11-01,sales.qty.total,70,today
//   2) 宽表（速卖通导出常见）：用 --map 给出「表头 → 口径」的映射，date 列单独映射为 "date"
//        --map '{"日期":"date","支付件数":"sales.qty.total","访客数":"visitor"}'
//        （未映射的列忽略；映射列须是数字才取，空/非数跳过并计数）
//
// 用法：
//   node scripts/import-platform-export.mjs --csv <export.csv> --store 400370 [--window 30d]
//   node scripts/import-platform-export.mjs --csv <export.csv> --store 400370 --map '<json>'
//   ... --dry-run  # 只校验+报数，不写盘
//   ... --out-dir data/metrics/_import-test  # 改输出目录（自测用）
//
// 退出码：0 正常 / 1 有被跳过且想强校验时 / 2 参数或文件错误

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const METRICS = path.join(ROOT, "data", "metrics");

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const has = (n) => argv.includes(n);
const die = (m) => { console.error(`[import-platform-export] ${m}`); process.exit(2); };

const CSV = opt("--csv");
const STORE = opt("--store", "400370");
const DEF_WINDOW = opt("--window", "30d");
const MAP = opt("--map");
const DRY = has("--dry-run");
const OUT_DIR = opt("--out-dir", path.join(METRICS, "facts", "platform-export"));

if (!CSV) die("必须给 --csv <file>");
if (!fs.existsSync(CSV)) die(`找不到 CSV：${CSV}`);

// 已知口径白名单（来自 config/metrics-schema.json 的主口径；未知只告警不拒，schema 才是权威）
const KNOWN = new Set([
  "sales.qty.total", "sales.qty.direct", "sales.amount",
  "inventory.actual", "inventory.occupied", "inventory.transit", "inventory.sellable",
  "exposure", "visitor", "add_cart", "favorite", "pay_buyer", "pay_qty",
  "conv.rate", "conv.buyers",
]);

// ── 极简 CSV 解析（支持双引号包裹、引号内逗号、"" 转义）──
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length && !(r.length === 1 && r[0].trim() === ""));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normDate(s) {
  const t = String(s ?? "").trim().replace(/\//g, "-");
  if (DATE_RE.test(t)) return t;
  // 2026/11/1 → 2026-11-01
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

function main() {
  const text = fs.readFileSync(CSV, "utf8").replace(/^\uFEFF/, ""); // 去 BOM
  const rows = parseCsv(text);
  if (rows.length < 2) die("CSV 至少要有表头 + 1 行数据");

  const header = rows[0].map((h) => h.trim());
  const lower = header.map((h) => h.toLowerCase());
  const idx = (name) => lower.indexOf(String(name).toLowerCase());

  // 输出容器：date → records[]
  const byDate = new Map();
  let skipped = 0, unknown = new Set(), written = 0;
  const nowISO = new Date().toISOString();

  const push = (date, caliber, value, window, store) => {
    if (!Number.isFinite(value)) { skipped++; return; }
    if (!KNOWN.has(caliber)) unknown.add(caliber);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({
      caliber, storeId: store, subject: "STORE", window,
      value, unit: null, reason: null,
      statDate: date, capturedAt: nowISO, revision: 1,
      meta: { source: "platform-export" },
    });
    written++;
  };

  if (MAP) {
    // ── 宽表 + 映射 ──
    let mapping;
    try { mapping = JSON.parse(MAP); } catch { die("--map 不是合法 JSON"); }
    // 反转：口径 → 列名（"date" 特殊）
    const dateCol = Object.keys(mapping).find((k) => mapping[k] === "date");
    if (!dateCol) die("--map 必须有一列映射为 \"date\"");
    const caliberCols = Object.entries(mapping).filter(([, v]) => v !== "date");
    const dIdx = idx(dateCol);
    if (dIdx < 0) die(`映射里的日期列 "${dateCol}" 不在表头：${header.join(", ")}`);

    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];
      const date = normDate(cols[dIdx]);
      if (!date) { skipped++; continue; }
      for (const [col, caliber] of caliberCols) {
        const ci = idx(col);
        if (ci < 0) continue;
        const raw = String(cols[ci] ?? "").replace(/[,%¥\s]/g, "");
        const v = raw === "" ? NaN : Number(raw);
        push(date, caliber, v, DEF_WINDOW, STORE);
      }
    }
  } else {
    // ── 长表：date,caliber,value[,window][,store] ──
    const di = idx("date"), ci = idx("caliber"), vi = idx("value");
    const wi = idx("window"), si = idx("store");
    if (di < 0 || ci < 0 || vi < 0) die("长表需要 date,caliber,value 三列（或用 --map 走宽表）");
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];
      const date = normDate(cols[di]);
      const caliber = String(cols[ci] ?? "").trim();
      const v = Number(String(cols[vi] ?? "").replace(/[,%¥\s]/g, ""));
      if (!date || !caliber) { skipped++; continue; }
      const window = wi >= 0 && cols[wi] ? String(cols[wi]).trim() : DEF_WINDOW;
      const store = si >= 0 && cols[si] ? String(cols[si]).trim() : STORE;
      push(date, caliber, v, window, store);
    }
  }

  const dates = [...byDate.keys()].sort();
  console.log(`\n# 导入预览 · ${path.basename(CSV)}`);
  console.log(`  表头: ${header.join(" | ")}`);
  console.log(`  解析：${dates.length} 个日期，${written} 条记录，跳过 ${skipped} 行（空/非数/坏日期）`);
  console.log(`  日期范围: ${dates[0]} ~ ${dates[dates.length - 1]}`);
  if (unknown.size) console.log(`  ⚠️ 未知口径(不在白名单，仅告警): ${[...unknown].join(", ")}`);
  if (!written) { console.error("没有可写入的记录。"); process.exit(1); }

  if (DRY) { console.log("\n[dry-run] 未写盘。"); return; }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const d of dates) {
    const f = path.join(OUT_DIR, `${d}.jsonl`);
    const body = byDate.get(d).map((x) => JSON.stringify(x)).join("\n") + "\n";
    fs.writeFileSync(f, body, "utf8");
  }
  console.log(`\n已写 ${dates.length} 个文件 → ${path.relative(ROOT, OUT_DIR)}/`);
  console.log(`下一步：node scripts/build-ops-db.mjs --rebuild   （并入 fact_store_daily）`);
}

main();
