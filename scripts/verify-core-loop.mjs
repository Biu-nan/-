#!/usr/bin/env node
// scripts/verify-core-loop.mjs
// 核心闭环「一键验收」：按顺序跑全部核心检查，聚合 PASS/FAIL，退出码 0=全绿。
//
// 覆盖的闭环环节：
//   数据(ops.db 重建) → 巡检(ops-daily-check) → 采购判定(evals) → Workflow(事件链/Gate)
//   → 真实补货清单(D5 桥) → 治理护栏(A2d 验证器/片段自测)
//
// 用法：node scripts/verify-core-loop.mjs
// 退出码：0 全过；1 有失败；2 环境错误
//
// 注意：全部子进程串行执行（openEnv/node:sqlite 都不并发），只读 + 写 data/（gitignore）。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE = process.execPath;
const LOG = path.join(ROOT, "data", "metrics", "core-loop-acceptance.log");

const CHECKS = [
  { name: "采购用例 11/11", script: "agents/purchase-inventory/src/cli.js", args: ["--evals"], grep: /通过 11，失败 0/ },
  { name: "采购 Workflow 11/11", script: "agents/purchase-inventory/evals/verify-workflow.mjs", args: [], grep: /验收 11 项，通过 11，失败 0/ },
  { name: "ops.db 重建", script: "scripts/build-ops-db.mjs", args: ["--rebuild"], grep: /fact_store_daily/ },
  { name: "数据巡检", script: "scripts/ops-daily-check.mjs", args: ["--json"], grep: null },
  { name: "D5 真实补货清单", script: "agents/purchase-inventory/src/snapshot-from-opsdb.mjs", args: ["--store", "400370", "--batch"], grep: /RESTOCK/ },
  { name: "A2d 验证器自测", script: "scripts/verify-production-gate.mjs", args: ["--self-test"], grep: /SELF-TEST PASS/ },
  { name: "A2d 片段自测", script: "scripts/verify-production-gate.mjs", args: ["--self-test-snippet"], grep: /SNIPPET-TEST PASS/ },
];

function runOne(c) {
  const started = Date.now();
  const r = spawnSync(NODE, [path.join(ROOT, c.script), ...c.args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300000,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const exitOk = r.status === 0;
  const grepOk = c.grep ? c.grep.test(out) : true;
  const pass = exitOk && grepOk && !r.error;
  return {
    name: c.name,
    pass,
    detail: `exit=${r.status ?? "?"}${grepOk ? "" : " · 输出未匹配"}${r.error ? " · " + r.error.code : ""}`,
    ms: Date.now() - started,
    tail: out.split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 160),
  };
}

function main() {
  console.log(`\n# 核心闭环验收 · node=${process.execPath}\n`);
  const results = [];
  for (const c of CHECKS) {
    process.stdout.write(`  running ${c.name} ... `);
    const res = runOne(c);
    results.push(res);
    console.log(res.pass ? "PASS" : "FAIL");
  }

  const fail = results.filter((r) => !r.pass).length;
  console.log("\n  环节                      结果   耗时   说明");
  for (const r of results) {
    console.log(`  ${r.name.padEnd(22)} ${(r.pass ? "PASS" : "FAIL").padEnd(5)} ${String(r.ms).padStart(5)}ms  ${r.detail}`);
  }
  console.log(`\n# ${results.length} 项，通过 ${results.length - fail}，失败 ${fail}`);

  const stamp = new Date().toISOString();
  const lines = results.map((r) => `${r.pass ? "PASS" : "FAIL"}\t${r.name}\t${r.ms}ms\t${r.detail}`);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `\n===== ${stamp} · ${results.length - fail}/${results.length} PASS =====\n${lines.join("\n")}\n`, "utf8");
  } catch { /* log 失败不影响验收结论 */ }

  console.log(fail === 0 ? "\n✅ 核心闭环全绿。" : "\n❌ 有环节未过，见上表。");
  process.exit(fail === 0 ? 0 : 1);
}

try { main(); } catch (e) { console.error("FATAL", e.message); process.exit(2); }
