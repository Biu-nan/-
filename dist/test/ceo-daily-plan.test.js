import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/ceo-decision-cases.json", import.meta.url), "utf8"));
const moduleUrl = new URL("../src/ceo-daily-plan.js", import.meta.url);
function task(taskId, estimatedMinutes, priorityClass = "GOAL", overrides = {}) {
  return { taskId, actionId: "investigate", title: `核对事项 ${taskId}`, acceptance: "记录对象、来源和核对结论", storeRef: structuredClone(fixture.goal.storeRef), mode: "INVESTIGATION", priorityClass, estimatedMinutes, deadline: "2027-01-02T08:00:00Z", dependsOn: [], requiresEvidence: [], ...overrides };
}
function input() {
  const { goal, decision, facts, now } = structuredClone(fixture);
  return { goal, decision, facts, now: new Date(now), candidates: [task("a", 20, "HARD"), task("b", 40), task("c", 120), task("d", 60, "OPTIONAL")] };
}
async function build(value) { return (await import(moduleUrl)).buildDailyPlan(value); }
const ids = values => values.map(value => value.taskId);

test("allocates 180 minutes after a 60-minute buffer and explains the deferred task", async () => {
  const x = input(), before = structuredClone(x);
  const result = await build(x);
  assert.equal(result.schema, "ceo-daily-plan/v1"); assert.equal(result.status, "DRAFT");
  assert.equal(result.commitment, "WITHIN_CAPACITY");
  assert.deepEqual(result.capacity, { availableMinutes: 180, usedMinutes: 180 });
  assert.deepEqual(ids(result.tasks), ["a", "b", "c"]);
  assert.deepEqual(ids(result.deferred), ["d"]);
  assert.equal(result.deferred[0].reason, "CAPACITY_EXCEEDED");
  assert.equal(result.tasks[0].acceptance, "记录对象、来源和核对结论");
  assert.deepEqual(x, before);
});

test("unknown capacity never invents a four-hour commitment", async () => {
  const x = input(); x.goal.capacityMinutes = null;
  const result = await build(x);
  assert.equal(result.commitment, "UNCOMMITTED");
  assert.equal(result.capacity.availableMinutes, null); assert.equal(result.capacity.usedMinutes, 0);
  assert.deepEqual(result.tasks, []);
  assert.equal(result.deferred.length, 4);
});

test("unconfirmed buffer also prevents a capacity commitment", async () => {
  const x = input(); x.goal.bufferMinutes = null;
  const result = await build(x);
  assert.equal(result.commitment, "UNCOMMITTED"); assert.deepEqual(result.tasks, []);
});

test("expired deadline remains blocked with its original date and id", async () => {
  const x = input(); x.candidates[0].deadline = "2027-01-01T23:59:00Z";
  const result = await build(x);
  const blocked = result.blocked.find(t => t.taskId === "a");
  assert.equal(blocked.reason, "DEADLINE_PASSED"); assert.equal(blocked.deadline, "2027-01-01T23:59:00Z");
});

test("a task that cannot fit before its deadline is not promised", async () => {
  const x = input(); x.candidates = [task("a", 120, "HARD", { deadline: "2027-01-02T00:30:00Z" })];
  const result = await build(x);
  assert.deepEqual(result.tasks, []); assert.equal(result.blocked[0].reason, "DEADLINE_UNACHIEVABLE");
});

test("unselected action cannot enter the plan", async () => {
  const x = input(); x.candidates[0].actionId = "hold";
  const result = await build(x);
  assert.equal(result.blocked.find(t => t.taskId === "a").reason, "NOT_SELECTED_ACTION");
  assert.ok(!ids(result.tasks).includes("a"));
});

test("same-name task from a different store is blocked", async () => {
  const x = input(); x.candidates[0].storeRef.environmentId = "other-store";
  const result = await build(x);
  assert.equal(result.blocked.find(t => t.taskId === "a").reason, "STORE_MISMATCH");
});

test("required evidence must exist with its current version", async () => {
  const x = input(); x.candidates[0].requiresEvidence = [{ factId: "absent", version: 1 }];
  x.candidates[1].requiresEvidence = [{ factId: "paid", version: 2 }];
  const result = await build(x);
  assert.equal(result.blocked.find(t => t.taskId === "a").reason, "MISSING_REQUIRED_EVIDENCE");
  assert.equal(result.blocked.find(t => t.taskId === "b").reason, "MISSING_REQUIRED_EVIDENCE");
});

test("candidate-only future evidence cannot enter the draft", async () => {
  const x = input(); x.decision.evidenceRefs = x.decision.evidenceRefs.filter(ref => ref.factId !== "stock");
  x.facts[2].observedAt = "2027-02-01T00:00:00Z";
  x.candidates[0].requiresEvidence = [{ factId: "stock", version: 1 }];
  const result = await build(x);
  assert.ok(!ids(result.tasks).includes("a")); assert.equal(result.blocked.find(t => t.taskId === "a").reason, "MISSING_REQUIRED_EVIDENCE");
});

test("repeated dependency edges are rejected before urgency propagation", async () => {
  const x = input(); x.candidates = [task("a", 1), task("b", 1, "HARD", { dependsOn: ["a", "a"] })];
  await assert.rejects(() => build(x), { code: "INVALID_DEPENDENCY" });
  x.candidates = Array.from({ length: 20 }, (_, i) => task(`t${i}`, 1, "GOAL", { deadline: null, dependsOn: i ? Array(8).fill(`t${i - 1}`) : [] }));
  await assert.rejects(() => build(x), { code: "INVALID_DEPENDENCY" });
});

test("evidence-backed action preparation can be drafted before December outcomes exist", async () => {
  const x = input(); x.now = new Date("2026-10-26T04:00:00Z");
  const stock = x.facts[2]; stock.period = { start: "2026-10-25T00:00:00+08:00", end: "2026-10-26T00:00:00+08:00" }; stock.observedAt = "2026-10-26T00:00:00Z";
  x.facts = [stock]; x.decision.evidenceRefs = [{ factId: "stock", version: 1 }]; x.decision.reviewAt = "2026-10-27T00:00:00Z";
  for (const claim of x.decision.claims) { claim.verdict = "PENDING_OBSERVATION"; claim.period = null; claim.evidenceBindings = []; }
  x.decision.claims.push({ claimId: "basis", actionId: "investigate", targetId: "daily-paid-items", claimType: "ACTION_BASIS", verdict: "SUPPORTED", caliber: stock.caliber, unit: stock.unit, period: structuredClone(stock.period), evidenceBindings: [{ factId: "stock", version: 1, role: "PRIMARY_METRIC" }] });
  x.candidates = [task("prepare", 10, "GOAL", { mode: "ACTION", deadline: null, requiresEvidence: [{ factId: "stock", version: 1 }] })];
  const result = await build(x);
  assert.deepEqual(ids(result.tasks), ["prepare"]); assert.equal(result.status, "DRAFT"); assert.equal(result.goalAchieved, undefined);
});

test("unreconciled costs allow investigation drafts but block action drafts", async () => {
  const x = input(); x.facts[1].coverage.costsReconciled = false; x.candidates[1].mode = "ACTION";
  const result = await build(x);
  assert.ok(ids(result.tasks).includes("a"));
  assert.equal(result.blocked.find(t => t.taskId === "b").reason, "NEEDS_EVIDENCE");
  assert.ok(result.warnings.some(w => w.code === "COSTS_UNRECONCILED"));
  assert.equal(result.goalAchieved, undefined);
});

test("an invalid decision blocks all candidates without losing tasks", async () => {
  const x = input(); x.decision.goalVersion = 99;
  const result = await build(x);
  assert.equal(result.commitment, "UNCOMMITTED"); assert.deepEqual(result.tasks, []);
  assert.deepEqual(ids(result.blocked), ["a", "b", "c", "d"]);
  assert.ok(result.blocked.every(t => t.reason === "INVALID_DECISION"));
});

test("a no-action decision cannot smuggle candidates into the schedule", async () => {
  const x = input(); x.decision.conclusion = "NO_ACTION"; x.decision.chosenActionId = null; x.decision.options = [];
  const result = await build(x);
  assert.deepEqual(result.tasks, []); assert.ok(result.blocked.every(t => t.reason === "NO_ACTION_SELECTED"));
});

test("a blocked dependency blocks its dependent but keeps an independent task", async () => {
  const x = input(); x.candidates = [task("a", 20, "HARD", { actionId: "hold" }), task("b", 30, "GOAL", { dependsOn: ["a"] }), task("c", 40)];
  const result = await build(x);
  assert.equal(result.blocked.find(t => t.taskId === "b").reason, "DEPENDENCY_BLOCKED");
  assert.deepEqual(ids(result.tasks), ["c"]);
});

test("deferred prerequisites never leave a dependent ready", async () => {
  const x = input(); x.candidates = [task("a", 200, "HARD"), task("b", 10, "HARD", { dependsOn: ["a"] })];
  const result = await build(x);
  assert.deepEqual(result.tasks, []);
  assert.equal(result.deferred.find(t => t.taskId === "b").reason, "DEPENDENCY_DEFERRED");
});

test("hard-deadline critical path outranks an unrelated lower-priority task", async () => {
  const x = input(); x.candidates = [task("parent", 20, "OPTIONAL"), task("hard", 120, "HARD", { dependsOn: ["parent"] }), task("other", 60, "GOAL")];
  const result = await build(x);
  assert.deepEqual(ids(result.tasks), ["parent", "hard"]);
  assert.deepEqual(ids(result.deferred), ["other"]);
});

test("same-class tasks prefer an earlier deadline then stable task id", async () => {
  const x = input(); x.candidates = [task("c", 20), task("b", 20, "GOAL", { deadline: "2027-01-02T05:00:00Z" }), task("a", 20)];
  const result = await build(x);
  assert.deepEqual(ids(result.tasks), ["b", "a", "c"]);
});

for (const [name, mutate, code] of [
  ["duplicate task id", x => { x.candidates[1].taskId = "a"; }, "DUPLICATE_TASK"],
  ["dependency cycle", x => { x.candidates[0].dependsOn = ["b"]; x.candidates[1].dependsOn = ["a"]; }, "INVALID_DEPENDENCY"],
  ["missing dependency", x => { x.candidates[1].dependsOn = ["absent"]; }, "INVALID_DEPENDENCY"],
  ["timezone-free deadline", x => { x.candidates[0].deadline = "2027-01-02T01:00:00"; }, "INVALID_DEADLINE"],
  ["zero duration", x => { x.candidates[0].estimatedMinutes = 0; }, "INVALID_DURATION"],
  ["fractional duration", x => { x.candidates[0].estimatedMinutes = 1.5; }, "INVALID_DURATION"],
  ["missing acceptance", x => { delete x.candidates[0].acceptance; }, "INVALID_TASK"],
  ["buffer exceeds capacity", x => { x.goal.bufferMinutes = 241; }, "INVALID_CAPACITY"],
  ["more than 20 candidates", x => { x.candidates = Array.from({ length: 21 }, (_, i) => task(`t${i}`, 1)); }, "TASK_LIMIT_EXCEEDED"],
]) {
  test(`rejects ${name}`, async () => {
    const x = input(); mutate(x);
    await assert.rejects(() => build(x), { code });
  });
}

test("semantic input reordering preserves plan and task identities", async () => {
  const a = input(), b = structuredClone(a);
  b.candidates.reverse(); b.facts.reverse(); b.goal.targets.reverse(); b.decision.options.reverse(); b.decision.claims.reverse(); b.decision.evidenceRefs.reverse();
  const p = await build(a), q = await build(b);
  assert.equal(p.planId, q.planId); assert.deepEqual(ids(p.tasks), ids(q.tasks));
  const every = [...q.tasks, ...q.deferred, ...q.blocked];
  assert.deepEqual(ids(every).sort(), ["a", "b", "c", "d"]);
});

test("a changed decision version produces a different draft rather than overwriting identity", async () => {
  const a = input(), b = structuredClone(a); b.decision.decisionId = "decision-2";
  assert.notEqual((await build(a)).planId, (await build(b)).planId);
});

test("a deadline expiring within the same date changes the draft identity", async () => {
  const a = input(), b = structuredClone(a); a.candidates[0].deadline = "2027-01-02T01:00:00Z"; b.candidates = structuredClone(a.candidates); b.now = new Date("2027-01-02T02:00:00Z");
  assert.notEqual((await build(a)).planId, (await build(b)).planId);
});

test("malformed decision arrays return a blocked draft instead of crashing the fingerprint", async () => {
  const x = input(); x.decision.claims = [null];
  const result = await build(x);
  assert.equal(result.commitment, "UNCOMMITTED"); assert.equal(result.blocked.length, 4);
});

test("invalid plan timezone produces a controlled input error", async () => {
  const x = input(); x.goal.period.timeZone = "Not/AZone";
  await assert.rejects(() => build(x), { code: "INVALID_INPUT" });
});

test("monotonic processing budget halts a long-running local pass", async t => {
  const { buildDailyPlan } = await import(moduleUrl);
  let calls = 0;
  t.mock.method(performance, "now", () => calls++ === 0 ? 0 : 61000);
  assert.throws(() => buildDailyPlan(input()), { code: "BUDGET_EXCEEDED" });
});
