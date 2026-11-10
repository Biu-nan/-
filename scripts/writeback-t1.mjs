#!/usr/bin/env node
/**
 * E1 · T1 回写抽取器（第一步范围）
 *
 * 批准范围（Lance 2026-11-10，选项 A）：只做 T1 口径修正的
 *   「报告 → 抽取 → 变更建议 → Human 逐条批准」，不碰 T2/T3。
 *
 * 红线：本脚本**绝不修改** prompts/ / config/ / contract.md。
 * 它只把候选写成 data/writeback-proposals/{date}/{seq}.json，等 Human 批。
 *
 * 闸门：evidenceRef 为空、指向报告外部、或六列不全 → 拒收该行。
 * 类型非 T1 → 跳过（本阶段未批准）。
 *
 * 用法：
 *   node scripts/writeback-t1.mjs --report <报告.md>
 *   node scripts/writeback-t1.mjs --report <报告.md> --dry-run
 */
import { readFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const valueOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const reportArg = valueOf("report", null);
if (!reportArg) {
  console.error("用法：node scripts/writeback-t1.mjs --report <报告.md> [--dry-run]");
  process.exit(2);
}
const reportPath = path.resolve(ROOT, reportArg);
const dryRun = flag("dry-run");
const md = await readFile(reportPath, "utf8");

// 只解析「可回写结论」表；其它表格不碰。
const lines = md.split(/\r?\n/);
const start = lines.findIndex((l) => /^#{1,3}\s*可回写结论/.test(l));
if (start < 0) {
  console.log("未发现「可回写结论」表，无 T1 候选。");
  process.exit(0);
}

const COLS = ["类型", "目标文件", "目标段落", "原内容", "建议新内容", "依据（本报告证据位置）"];
const rows = [];
let headerSeen = false;
for (let i = start + 1; i < lines.length; i++) {
  const l = lines[i].trim();
  if (!l.startsWith("|")) {
    if (headerSeen && rows.length) break; // 表格结束
    continue;
  }
  const cells = l.slice(1, -1).split("|").map((c) => c.trim());
  if (cells.some((c) => /^[-: ]+$/.test(c))) { headerSeen = true; continue; } // 分隔行
  if (cells[0] === COLS[0] || cells[0] === "类型") { headerSeen = true; continue; }
  if (!headerSeen) continue;
  rows.push(cells);
}

const EXTERNAL_HINT = /(参考行业经验|业界惯例|网上|外部资料|经验判断|一般来说)/;
const INTERNAL_REF = /(§|第\s*\d+\s*行|L\d+|表\s*\d+|图\s*\d+)/;

const accepted = [];
const rejected = [];
for (const cells of rows) {
  if (cells.length < 6) { rejected.push({ cells, reason: "列数不足 6" }); continue; }
  const [type, targetFile, targetSection, oldText, newText, evidenceRef] = cells.slice(0, 6);
  if (type !== "T1") { rejected.push({ cells, reason: `类型 ${type} 未在本阶段批准范围（仅 T1）` }); continue; }
  if (!targetFile || !targetSection || !newText) { rejected.push({ cells, reason: "目标文件/段落/建议新内容有空值" }); continue; }
  if (!evidenceRef || EXTERNAL_HINT.test(evidenceRef) || !INTERNAL_REF.test(evidenceRef)) {
    rejected.push({ cells, reason: "evidenceRef 为空或指向报告外部" }); continue;
  }
  accepted.push({ type, targetFile, targetSection, oldText, newText, evidenceRef });
}

console.log(`报告：${path.relative(ROOT, reportPath)}`);
console.log(`解析到 ${rows.length} 行，T1 通过闸门 ${accepted.length}，拒收 ${rejected.length}`);
for (const r of rejected) console.log(`  拒收：${r.reason} | ${r.cells[0] ?? ""}`);
if (!accepted.length) process.exit(0);

const date = new Date().toISOString().slice(0, 10);
const dir = path.join(ROOT, "data", "writeback-proposals", date);
let seq = 1;
try { seq = (await readdir(dir)).filter((f) => /^\d+\.json$/.test(f)).length + 1; } catch { /* 目录不存在 */ }

const proposals = accepted.map((a, n) => ({
  ...a,
  status: "PENDING_HUMAN_APPROVAL",
  sourceReport: path.relative(ROOT, reportPath).replace(/\\/g, "/"),
  proposalId: `${date}-${String(seq + n).padStart(3, "0")}`,
  scope: "E1-step1-T1-only",
  autoApply: false,
}));

if (dryRun) {
  console.log("\n[dry-run] 以下建议不会写盘：");
  for (const p of proposals) console.log(JSON.stringify(p, null, 2));
} else {
  await mkdir(dir, { recursive: true });
  for (let n = 0; n < proposals.length; n++) {
    const file = path.join(dir, `${String(seq + n).padStart(3, "0")}.json`);
    await writeFile(file, JSON.stringify(proposals[n], null, 2) + "\n", "utf8");
    console.log(`  已生成 ${path.relative(ROOT, file).replace(/\\/g, "/")}（等待 Human 批准，未落盘到任何 prompts/config）`);
  }
}

// 显式声明：本脚本不写 prompts/ / config/ / contract.md。
console.log("\n⛔ 闸门：未修改任何 prompts/ / config/ / contract.md；落盘须 Human 逐条批准后另行走流程。");
