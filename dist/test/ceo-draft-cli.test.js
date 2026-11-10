import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const cliUrl = new URL("../../scripts/ceo-draft-plan.mjs", import.meta.url);
const cli = fileURLToPath(cliUrl);
const fixture = JSON.parse(readFileSync(new URL("./fixtures/ceo-decision-cases.json", import.meta.url), "utf8"));
function run(args) { return spawnSync(process.execPath, args, { encoding: "utf8", timeout: 10000, windowsHide: true }); }
async function file(t, content) {
  const base = path.resolve(tmpdir()), dir = await mkdtemp(path.join(base, "ceo-draft-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(dir)), base); assert.ok(path.basename(dir).startsWith("ceo-draft-"));
    await rm(dir, { recursive: true, force: true });
  });
  const name = path.join(dir, "input.json"); await writeFile(name, content); return name;
}
function draft() {
  const { goal, decision } = structuredClone(fixture);
  goal.targets[1].caliber = null; goal.targets[1].metricStatus = "PENDING";
  goal.capacityMinutes = null; goal.bufferMinutes = null;
  decision.evidenceRefs = []; decision.reviewAt = new Date(Date.now() + 86400000).toISOString();
  decision.conclusion = "INSUFFICIENT_EVIDENCE";
  for (const claim of decision.claims) { claim.verdict = "INSUFFICIENT_EVIDENCE"; claim.period = null; claim.evidenceBindings = []; }
  return { goal, decision, facts: [], candidates: [{ taskId: "collect-costs", actionId: "investigate", title: "核对成本与品质罚款", acceptance: "逐项记录成本、归属期和待补证项", storeRef: structuredClone(goal.storeRef), mode: "INVESTIGATION", priorityClass: "GOAL", estimatedMinutes: 45, deadline: null, dependsOn: [], requiresEvidence: [] }] };
}

test("CLI produces a noncommitted draft without changing its input file", async t => {
  const content = JSON.stringify(draft()), input = await file(t, content);
  const result = run([cli, "--input", input]);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema, "ceo-daily-plan/v1"); assert.equal(output.status, "DRAFT");
  assert.equal(output.commitment, "UNCOMMITTED"); assert.equal(output.tasks.length, 0);
  assert.equal(output.deferred[0].taskId, "collect-costs");
  assert.equal(await readFile(input, "utf8"), content);
});

test("CLI ignores a supplied clock that would revive an expired decision", async t => {
  const value = draft(); value.now = "2000-01-01T00:00:00Z"; value.decision.reviewAt = "2000-01-02T00:00:00Z";
  const input = await file(t, JSON.stringify(value));
  const result = run([cli, "--input", input]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.tasks.length, 0); assert.equal(output.blocked[0].reason, "INVALID_DECISION");
  assert.ok(output.warnings.some(w => w.code === "EXPIRED_DECISION"));
});

test("CLI rejects missing arguments and invalid JSON without echoing private text", async t => {
  const missing = run([cli]); assert.equal(missing.status, 1); assert.match(missing.stderr, /INVALID_ARGUMENTS/);
  const input = await file(t, "{private-secret-invalid");
  const invalid = run([cli, "--input", input]);
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /INVALID_INPUT/);
  assert.doesNotMatch(invalid.stderr, /private-secret|SyntaxError|at .*\.mjs/);
});

test("CLI import does not read arguments or produce output", () => {
  const result = run(["--input-type=module", "-e", `await import(${JSON.stringify(cliUrl.href)});console.log('IMPORTED');`]);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), "IMPORTED"); assert.equal(result.stderr, "");
});
