#!/usr/bin/env node
// agents/purchase-inventory/src/cli.js
// 用法：
//   node agents/purchase-inventory/src/cli.js --evals
//   node agents/purchase-inventory/src/cli.js --input <case.json>
//   node agents/purchase-inventory/src/cli.js --snapshot <snap.json> --store 400370 --as-of <ISO>
//   node agents/purchase-inventory/src/cli.js --workflow --snapshot <snap.json> [--decision approve|reject]
//
// 退出码：0 正常 / 1 有失败或被拒 / 2 参数或环境错误

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOne } from "./engine.js";
import { loadLimits } from "./limits.js";
import { audit, verifyAudit, fromSnapshotFile } from "./audit.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES_FILE = path.join(HERE, "..", "evals", "cases.json");

// ────────────────────────── 断言匹配 ──────────────────────────

const DOC_KEYS = new Set(["note", "note2", "precedenceNote"]);

function hasKeyDeep(value, target) {
  if (Array.isArray(value)) return value.some((v) => hasKeyDeep(v, target));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k.toLowerCase() === String(target).toLowerCase()) return true;
      if (hasKeyDeep(v, target)) return true;
    }
  }
  return false;
}

function checkAssertions(assertions, result) {
  const fails = [];
  for (const [k, expected] of Object.entries(assertions)) {
    if (DOC_KEYS.has(k)) continue;
    let ok = false;
    let actual = "(n/a)";

    switch (k) {
      case "calibersUsedExcludes":
        actual = result.calibersUsed;
        ok = expected.every((c) => !(result.calibersUsed ?? []).includes(c));
        break;
      case "reasonMustContain":
        actual = result.reason;
        ok = expected.every((s) => String(result.reason ?? "").includes(s));
        break;
      case "reasonMustNotContain":
        actual = result.reason;
        ok = expected.every((s) => !String(result.reason ?? "").includes(s));
        break;
      case "reasonMustContainAny":
        actual = result.reason;
        ok = expected.some((s) => String(result.reason ?? "").includes(s));
        break;
      case "noActionFields":
        ok = expected.every((f) => !hasKeyDeep(result.batch, f));
        actual = "batch 内无这些字段";
        break;
      case "noClearanceAction":
        ok = !hasKeyDeep(result.batch, "clearance") && !hasKeyDeep(result.batch, "discount");
        actual = "batch 内无清仓/降价字段";
        break;
      case "unknownsNonEmpty":
        actual = result.unknowns;
        ok = Array.isArray(result.unknowns) && result.unknowns.length > 0;
        break;
      case "eachOrderMax":
        actual = result.eachOrderMax;
        ok = Number(result.eachOrderMax) <= expected;
        break;
      case "coverDays": {
        actual = result.coverDays;
        const m = typeof expected === "string" && /^([<>]=?)\s*(-?\d+(?:\.\d+)?)$/.exec(expected.trim());
        if (m) {
          const n = Number(m[2]);
          const v = Number(result.coverDays);
          ok = m[1] === ">" ? v > n : m[1] === ">=" ? v >= n : m[1] === "<" ? v < n : v <= n;
        } else {
          ok = Number(result.coverDays) === Number(expected);
        }
        break;
      }
      case "gate.required":
        actual = result.gate?.required;
        ok = result.gate?.required === expected;
        break;
      case "gate.defaultIfIgnored":
        actual = result.gate?.defaultIfIgnored;
        ok = result.gate?.defaultIfIgnored === expected;
        break;
      case "wholeBatchDiscarded":
        actual = result.wholeBatchDiscarded;
        ok = result.wholeBatchDiscarded === expected;
        break;
      default:
        actual = result[k];
        ok = JSON.stringify(actual) === JSON.stringify(expected);
    }

    if (!ok) fails.push({ key: k, expected, actual });
  }
  return fails;
}

// ────────────────────────── 用例批跑 ──────────────────────────

async function runEvals(file) {
  const limits = await loadLimits();
  const cases = JSON.parse(await readFile(file, "utf8"));
  let pass = 0;
  const failures = [];

  for (const c of cases) {
    let result;
    try {
      result = await runOne(c.input, limits);
    } catch (e) {
      result = { status: "ERROR", code: e.code ?? "UNKNOWN", violations: [{ detail: e.message }], warnings: [] };
    }
    const fails = checkAssertions(c.assertions ?? {}, result);
    if (fails.length === 0) {
      pass += 1;
      console.log(`  PASS  ${c.id}`);
    } else {
      failures.push({ id: c.id, fails, result });
      console.log(`  FAIL  ${c.id}`);
      for (const f of fails) {
        console.log(`          ${f.key}: 期望 ${JSON.stringify(f.expected)}，实际 ${JSON.stringify(f.actual)}`);
      }
    }
  }

  const total = cases.length;
  console.log("");
  console.log(`# 用例 ${total}，通过 ${pass}，失败 ${total - pass}`);
  return { total, pass, fail: total - pass, failures };
}

// ────────────────────────── 入口 ──────────────────────────

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const main = async () => {
  if (process.argv.includes("--evals")) {
    const file = arg("--file", CASES_FILE);
    console.log(`用例文件：${file}\n`);
    const r = await runEvals(file);
    process.exit(r.fail === 0 ? 0 : 1);
  }

  if (process.argv.includes("--workflow")) {
    const { runPurchaseWorkflow } = await import("./workflow.js");
    const snapshot = JSON.parse(await readFile(arg("--snapshot"), "utf8"));
    const r = await runPurchaseWorkflow({
      storeId: arg("--store", snapshot.storeId ?? "400370"),
      asOf: arg("--as-of", snapshot.asOf),
      calibers: snapshot.calibers,
      historyDays: Number(arg("--history-days", snapshot.historyDays ?? 14)),
      cumulativeSalesBefore30d: snapshot.cumulativeSalesBefore30d ?? 0,
      transitCollectedAt: snapshot.collectedAt ?? null,
      skuId: arg("--sku", snapshot.skuId ?? undefined),
      decision: arg("--decision", null),
      // arg() 的 fallback 默认是 null；显式传 undefined 会触发默认参数而拿到 null，
      // 进而让 workflow 的 path.dirname(eventRoot) 抛 ERR_INVALID_ARG_TYPE。
      // 用 `?? undefined` 把「未提供」显式还原成 undefined，才能走 workflow 的默认值。
      eventRoot: arg("--event-root") ?? undefined,
      artifactRoot: arg("--artifact-root") ?? undefined,
    });
    console.log(JSON.stringify(
      {
        runId: r.runId,
        status: r.status,
        verdict: r.verdict,
        eventCount: r.events.length,
        eventTypes: r.events.map((e) => e.type),
        reason: r.reason,
        verify: r.verify ? { verdict: r.verify.verdict, checks: r.verify.checks } : null,
        gate: r.gate ?? null,
        artifacts: r.artifacts ?? [],
      },
      null,
      2,
    ));
    process.exit(r.status === "BLOCKED" || r.status === "REJECTED" ? 1 : 0);
  }

  if (process.argv.includes("--resume")) {
    const { resumeDecision } = await import("./workflow.js");
    const r = await resumeDecision({
      runId: arg("--resume"),
      decision: arg("--decision"),
      eventRoot: arg("--event-root", undefined),
    });
    console.log(JSON.stringify(
      { runId: r.runId, decision: r.decision, status: r.status, reverify: r.reverify.verdict },
      null,
      2,
    ));
    process.exit(r.status === "VERIFIED" ? 0 : 1);
  }

  if (process.argv.includes("--snapshot")) {
    const storeId = arg("--store", "400370");
    const asOf = arg("--as-of", new Date().toISOString());
    const reader = fromSnapshotFile(arg("--snapshot"));
    const { record, hash } = await audit({ readCalibers: reader, storeId, asOf });
    const v = await verifyAudit({ record, hash, readCalibers: reader });
    console.log(JSON.stringify({ record, hash, verify: v }, null, 2));
    process.exit(v.verdict === "VERIFIED" ? 0 : 1);
  }

  const inputFile = arg("--input");
  if (inputFile) {
    const limits = await loadLimits();
    const input = JSON.parse(await readFile(inputFile, "utf8"));
    const r = await runOne(input, limits);
    console.log(JSON.stringify(r.status === "OK" ? r.batch : r, null, 2));
    process.exit(r.status === "OK" ? 0 : 1);
  }

  console.error("用法：--evals | --input <case.json> | --snapshot <snap.json> | --workflow --snapshot <snap.json>");
  process.exit(2);
};

main().catch((e) => {
  console.error(`FATAL ${e.code ?? ""} ${e.message}`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(2);
});
