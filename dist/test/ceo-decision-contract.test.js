import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/ceo-decision-cases.json", import.meta.url), "utf8"));
const moduleUrl = new URL("../src/ceo-decision-contract.js", import.meta.url);
const data = () => structuredClone(fixture);
async function validate(x) {
  const { validateCeoDecision } = await import(moduleUrl);
  return validateCeoDecision(x.decision, { goal: x.goal, facts: x.facts, now: new Date(x.now) });
}
function has(result, code) { assert.ok(result.errors.some(error => error.code === code), JSON.stringify(result)); }

test("validates evidence references without executing actions or mutating inputs", async () => {
  const x = data(), before = structuredClone(x);
  const result = await validate(x);
  assert.deepEqual(result, { ok: true, readiness: "VALIDATED", errors: [] });
  assert.deepEqual(x, before);
  assert.equal(result.authorized, undefined);
  assert.equal(result.goalAchieved, undefined);
});

for (const scenario of fixture.cases) {
  test(`${scenario.id} ${scenario.title}`, async () => {
    const x = data();
    if (scenario.mutation === "stale-stock") x.facts[2].version = 2;
    if (scenario.mutation === "platform-net") x.facts[1].caliber = "sales.amount.net";
    if (scenario.mutation === "partial-data") x.facts[0].coverage = { ratio: 0.2, complete: false };
    if (scenario.mutation === "other-store") x.facts[2].storeRef.environmentId = "other-store";
    if (scenario.mutation === "no-action") {
      x.decision.conclusion = "NO_ACTION"; x.decision.chosenActionId = null; x.decision.options = [];
      for (const claim of x.decision.claims) { claim.verdict = "INSUFFICIENT_EVIDENCE"; claim.evidenceBindings = []; claim.period = null; }
    }
    const result = await validate(x);
    assert.equal(result.readiness, scenario.readiness);
    has(result, scenario.code);
  });
}

for (const [name, mutate, code] of [
  ["goal version", x => { x.decision.goalVersion = 2; }, "STALE_GOAL"],
  ["goal identity", x => { x.decision.goalId = "other-goal"; }, "GOAL_MISMATCH"],
  ["unknown fact", x => { x.decision.evidenceRefs.push({ factId: "unknown", version: 1 }); }, "UNKNOWN_FACT"],
  ["same-name other store", x => { x.decision.storeRef.environmentId = "400371"; }, "STORE_MISMATCH"],
  ["unregistered policy version", x => { x.decision.policyVersion = "ceo-policy/v999"; }, "UNSUPPORTED_POLICY"],
  ["duplicate options", x => { x.decision.options[1].description = x.decision.options[0].description; }, "DUPLICATE_OPTION"],
  ["unknown choice", x => { x.decision.chosenActionId = "not-present"; }, "UNKNOWN_ACTION"],
  ["unknown target", x => { x.decision.affectsTargets.push("other-target"); }, "UNKNOWN_TARGET"],
  ["missing second goal assessment", x => { x.decision.claims.pop(); }, "MISSING_TARGET_ASSESSMENT"],
  ["undeclared evidence", x => { x.decision.evidenceRefs = x.decision.evidenceRefs.filter(r => r.factId !== "profit"); }, "UNDECLARED_REFERENCE"],
  ["ambiguous facts", x => { x.facts.push({ ...x.facts[0], version: 2 }); }, "AMBIGUOUS_FACT"],
  ["orders as paid items", x => { x.facts[0].unit = "单"; }, "CALIBER_MISMATCH"],
  ["partial month as whole month", x => { x.facts[1].period.start = "2026-12-02T00:00:00+08:00"; }, "WINDOW_MISMATCH"],
  ["previous month primary evidence", x => { x.facts[0].period = { start: "2026-11-30T00:00:00+08:00", end: "2026-12-01T00:00:00+08:00" }; }, "WINDOW_MISMATCH"],
  ["future capture", x => { x.facts[0].observedAt = "2027-01-04T00:00:00Z"; }, "FACT_FROM_FUTURE"],
  ["expired review", x => { x.decision.reviewAt = "2027-01-01T00:00:00Z"; }, "EXPIRED_DECISION"],
  ["review without timezone", x => { x.decision.reviewAt = "2027-01-03T00:00:00"; }, "INVALID_DECISION"],
  ["execution status in draft", x => { x.decision.status = "APPROVED"; }, "INVALID_DECISION"],
]) {
  test(`rejects ${name}`, async () => {
    const x = data(); mutate(x);
    const result = await validate(x);
    assert.equal(result.readiness, "INVALID"); has(result, code);
  });
}

for (const [name, mutate, code] of [
  ["unreconciled costs", x => { x.facts[1].coverage.costsReconciled = false; }, "COSTS_UNRECONCILED"],
  ["unknown quality penalty treatment", x => { delete x.facts[1].coverage.qualityPenaltiesExcluded; }, "QUALITY_PENALTY_UNCONFIRMED"],
  ["missing profit caliber", x => { x.goal.targets[1].caliber = null; x.goal.targets[1].metricStatus = "PENDING"; }, "METRIC_UNVERIFIED"],
  ["context used instead of primary", x => { x.decision.claims[1].evidenceBindings[0].role = "CONTEXT"; }, "MISSING_PRIMARY_EVIDENCE"],
  ["incomplete fact", x => { x.facts[0].quality = "INCOMPLETE"; x.facts[0].value = null; }, "INCOMPLETE_FACT"],
]) {
  test(`requests evidence for ${name}`, async () => {
    const x = data(); mutate(x);
    const result = await validate(x);
    assert.equal(result.readiness, "NEEDS_EVIDENCE"); has(result, code);
  });
}

test("missing goal definition asks confirmation rather than fabricating targets", async () => {
  const x = data(); x.goal = null;
  const result = await validate(x);
  assert.equal(result.readiness, "NEEDS_CONFIRMATION"); has(result, "MISSING_GOAL");
});

test("zero is valid evidence and is never replaced by the goal value", async () => {
  const x = data(); x.facts[0].value = 0;
  assert.equal((await validate(x)).readiness, "VALIDATED");
  assert.equal(x.facts[0].value, 0);
});

test("a legitimate no-action decision does not need three artificial options", async () => {
  const x = data(); x.decision.options = []; x.decision.chosenActionId = null; x.decision.conclusion = "NO_ACTION";
  assert.equal((await validate(x)).readiness, "VALIDATED");
});

test("invalid goal and fact containers return a controlled validation result", async () => {
  for (const [value, code] of [[null, "INVALID_CONTEXT"], [[], "UNKNOWN_FACT"], ["bad", "INVALID_CONTEXT"], [{}, "INVALID_CONTEXT"]]) {
    const x = data(); x.facts = value;
    const result = await validate(x);
    assert.equal(result.readiness, "INVALID"); has(result, code);
  }
});

test("malformed calendar dates are rejected without throwing", async () => {
  const x = data(); x.goal.period.fromDate = "2026-99-99";
  const result = await validate(x);
  assert.equal(result.readiness, "INVALID"); has(result, "INVALID_CONTEXT");
});

function preparation() {
  const x = data(); x.now = "2026-10-26T04:00:00Z";
  const stock = x.facts[2]; stock.period = { start: "2026-10-25T00:00:00+08:00", end: "2026-10-26T00:00:00+08:00" }; stock.observedAt = "2026-10-26T00:00:00Z";
  x.facts = [stock]; x.decision.evidenceRefs = [{ factId: "stock", version: 1 }]; x.decision.reviewAt = "2026-10-27T00:00:00Z";
  for (const claim of x.decision.claims) { claim.verdict = "PENDING_OBSERVATION"; claim.period = null; claim.evidenceBindings = []; }
  x.decision.claims.push({ claimId: "stock-basis", targetId: "daily-paid-items", actionId: "investigate", claimType: "ACTION_BASIS", verdict: "SUPPORTED", caliber: stock.caliber, unit: stock.unit, period: structuredClone(stock.period), evidenceBindings: [{ factId: "stock", version: 1, role: "PRIMARY_METRIC" }] });
  return x;
}

test("future outcomes do not block a selected preparation with sufficient action evidence", async () => {
  assert.deepEqual(await validate(preparation()), { ok: true, readiness: "VALIDATED", errors: [] });
});

for (const [name, mutate, readiness, code] of [
  ["missing action basis", x => { x.decision.claims.pop(); }, "NEEDS_EVIDENCE", "MISSING_ACTION_BASIS"],
  ["unverified profit definition", x => { x.goal.targets[1].metricStatus = "PENDING"; }, "NEEDS_EVIDENCE", "METRIC_UNVERIFIED"],
  ["unselected action basis", x => { x.decision.claims[2].actionId = "hold"; }, "INVALID", "UNSELECTED_ACTION_BASIS"],
  ["cross-store action evidence", x => { x.facts[0].storeRef.environmentId = "other"; }, "INVALID", "STORE_MISMATCH"],
  ["outcome already due", x => { x.now = "2027-01-02T00:00:00Z"; x.decision.reviewAt = "2027-01-03T00:00:00Z"; }, "INVALID", "OBSERVATION_ALREADY_DUE"],
]) {
  test(`future preparation still rejects ${name}`, async () => {
    const x = preparation(); mutate(x);
    const result = await validate(x); assert.equal(result.readiness, readiness); has(result, code);
  });
}
