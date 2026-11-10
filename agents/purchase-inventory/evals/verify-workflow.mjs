#!/usr/bin/env node
// agents/purchase-inventory/evals/verify-workflow.mjs
// D2 验收：把库存与采购 Workflow 的全部关键路径跑一遍，逐条断言。
//
// 用法：node agents/purchase-inventory/evals/verify-workflow.mjs
// 退出码：0 全过 / 1 有失败
//
// 为什么要有这个脚本：结论"我手动跑通了"不可复现。这里每条断言都对应一个
// 会被误实现的具体行为，改坏了必须红。

import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { runPurchaseWorkflow, resumeDecision } from "../src/workflow.js";
import { AgentEventStore } from "../../../dist/src/agent-event.js";

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`  FAIL  ${name}\n          ${e.message}`);
  }
};

const BASE = {
  storeId: "400370",
  asOf: "2026-11-10T12:00:00+08:00",
  calibers: {
    "inventory.actual": 120,
    "inventory.occupied": 20,
    "inventory.transit": 0,
    "sales.qty.total": 280,
  },
  historyDays: 14,
  cumulativeSalesBefore30d: 900,
  skuId: "SKU-T-001",
};

const root = await mkdtemp(path.join(os.tmpdir(), "pi-workflow-"));
const eventRoot = path.join(root, "events");
const artifactRoot = path.join(root, "artifacts");
const opts = () => ({ ...BASE, eventRoot, artifactRoot });

let runA = null;

// ── 1. RESTOCK 无人批复：必须停在 HUMAN_GATE，不能自己放行 ──
await check("RESTOCK 无人批复 → WAITING_HUMAN，事件链完整", async () => {
  const r = await runPurchaseWorkflow(opts());
  runA = r;
  assert.equal(r.status, "WAITING_HUMAN");
  assert.equal(r.verdict, "RESTOCK");
  assert.deepEqual(
    r.events.map((e) => e.type),
    ["INTENT", "DELEGATED", "ACCEPTED", "DELIVERED", "VERIFIED", "HUMAN_GATE"],
    "事件顺序不对",
  );
  assert.equal(r.verify.verdict, "VERIFIED");
  assert.equal(r.events.at(-1).payload.defaultIfIgnored, "stall", "Gate 只能 stall");
});

// ── 2. 核验在开闸之前：不能让人批未验过的东西 ──
await check("VERIFIED 出现在 HUMAN_GATE 之前", async () => {
  const types = runA.events.map((e) => e.type);
  assert.ok(types.indexOf("VERIFIED") < types.indexOf("HUMAN_GATE"), "核验必须在开闸前完成");
});

// ── 3. 交付物必须落盘且哈希可回读 ──
await check("交付物落盘且哈希与事件一致", async () => {
  const delivered = runA.events.find((e) => e.type === "DELIVERED");
  assert.ok(delivered.payload.artifacts.length >= 2, "至少 2 个产物");
  for (const art of delivered.payload.artifacts) {
    const buffer = await readFile(art.ref);
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(buffer).digest("hex");
    assert.equal(digest, art.sha256, `${art.ref} 哈希不符`);
  }
});

// ── 4. 续批：进程退出后还能回同一条 run 上批 ──
await check("续批 approve → VERIFIED 且写入 HUMAN_DECISION", async () => {
  const r = await resumeDecision({ runId: runA.runId, decision: "approve", eventRoot });
  assert.equal(r.status, "VERIFIED");
  const store = new AgentEventStore({ rootDir: eventRoot });
  const events = await store.readRun(runA.runId);
  assert.ok(events.some((e) => e.type === "HUMAN_DECISION"), "缺 HUMAN_DECISION");
  const chain = await store.verifyChain(runA.runId);
  assert.ok(chain.ok, `链断了：${chain.problems}`);
});

// ── 5. 重复批复必须被拒 ──
await check("重复批复 → ALREADY_DECIDED", async () => {
  await assert.rejects(
    () => resumeDecision({ runId: runA.runId, decision: "approve", eventRoot }),
    (e) => e.code === "ALREADY_DECIDED",
  );
});

// ── 6. 等待期间篡改产物：必须拒绝记录批复 ──
await check("等待期篡改产物 → ARTIFACTS_CHANGED，批复不落库", async () => {
  const r = await runPurchaseWorkflow(opts());
  assert.equal(r.status, "WAITING_HUMAN");
  const target = r.artifacts[0].ref;
  const data = JSON.parse(await readFile(target, "utf8"));
  data.items[0].suggestQty = 9999;
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`);

  await assert.rejects(
    () => resumeDecision({ runId: r.runId, decision: "approve", eventRoot }),
    (e) => e.code === "ARTIFACTS_CHANGED",
  );

  const events = await new AgentEventStore({ rootDir: eventRoot }).readRun(r.runId);
  assert.ok(!events.some((e) => e.type === "HUMAN_DECISION"), "篡改后不许留下批复记录");
});

// ── 7. 日切窗口：预检不过就停，不硬出结论 ──
await check("日切窗口 → BLOCKED，不出产物", async () => {
  const r = await runPurchaseWorkflow({ ...opts(), asOf: "2026-11-10T16:05:00+08:00" });
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.code, "DAY_CUT_WINDOW");
  assert.deepEqual(r.events.map((e) => e.type), ["INTENT", "DELEGATED", "ACCEPTED", "BLOCKED"]);
  assert.equal(r.artifacts.length, 0, "预检不过不许有产物");
});

// ── 8. DEAD_STOCK：无 Gate，但仍要核验 ──
await check("DEAD_STOCK → VERIFIED 且无 HUMAN_GATE", async () => {
  const r = await runPurchaseWorkflow({
    ...opts(),
    calibers: { "inventory.actual": 0, "inventory.occupied": 0, "inventory.transit": 0, "sales.qty.total": 0 },
    historyDays: 30,
    cumulativeSalesBefore30d: 174,
  });
  assert.equal(r.verdict, "DEAD_STOCK");
  assert.equal(r.status, "VERIFIED");
  assert.ok(!r.events.some((e) => e.type === "HUMAN_GATE"), "假死只标记，不该开闸");
  assert.ok(r.reason.includes("人工核查"), "理由必须写成待查");
});

// ── 9. 核验方与执行方同一 id：必须直接拒绝 ──
await check("核验方 == 执行方 → 构造即拒", async () => {
  await assert.rejects(
    () => runPurchaseWorkflow({ ...opts(), actors: { verifier: { kind: "verifier", id: "purchase-inventory" } } }),
    /核验方与执行方/,
  );
});

// ── 10. 全部 run 的哈希链必须完好 ──
await check("所有 run 哈希链完好", async () => {
  const store = new AgentEventStore({ rootDir: eventRoot });
  const runs = await store.listRuns();
  assert.ok(runs.length >= 4, `run 数偏少：${runs.length}`);
  for (const row of runs) {
    const chain = await store.verifyChain(row.runId);
    assert.ok(chain.ok, `${row.runId} 链断：${chain.problems}`);
  }
});

// ── 11. 事件是 append-only：文件行数只增不减 ──
await check("事件日志 append-only（无覆盖写）", async () => {
  const store = new AgentEventStore({ rootDir: eventRoot });
  const files = await readdir(eventRoot);
  for (const file of files.filter((f) => f.endsWith(".jsonl"))) {
    const runId = file.replace(/\.jsonl$/, "");
    const events = await store.readRun(runId);
    const seqs = events.map((e) => e.seq);
    assert.deepEqual(seqs, seqs.map((_, i) => i + 1), `${runId} 的 seq 不连续，说明有覆盖或缺失`);
  }
});

await rm(root, { recursive: true, force: true });

const fail = results.filter((r) => !r.ok).length;
console.log("");
console.log(`# 验收 ${results.length} 项，通过 ${results.length - fail}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
