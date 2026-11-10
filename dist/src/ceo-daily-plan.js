import { createHash } from "node:crypto";
import { validateCeoDecision } from "./ceo-decision-contract.js";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.trim().length > 0;
const rank = { HARD: 0, GOAL: 1, OPTIONAL: 2 };
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sameStore = (a, b) => a?.platform === b?.platform && a?.environmentId === b?.environmentId;

function reject(code) {
  const error = new Error(`Cannot build daily draft: ${code}`);
  error.code = code;
  throw error;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function normalizedInputs(goal, decision, facts, candidates) {
  const byId = key => (a, b) => compareText(a[key], b[key]);
  const refs = values => [...values].sort((a, b) => compareText(JSON.stringify(canonical(a)), JSON.stringify(canonical(b))));
  return canonical({
    goal: { ...goal, targets: [...goal.targets].sort(byId("targetId")) },
    decision: { ...decision,
      options: refs(decision.options || []), evidenceRefs: refs(decision.evidenceRefs || []),
      affectsTargets: [...(decision.affectsTargets || [])].sort(),
      claims: (decision.claims || []).map(claim => ({ ...claim, evidenceBindings: refs(claim.evidenceBindings || []) })).sort(byId("claimId")),
      assumptions: [...(decision.assumptions || [])].sort(), stopConditions: [...(decision.stopConditions || [])].sort(),
    },
    facts: [...facts].sort(byId("factId")),
    candidates: candidates.map(task => ({ ...task, dependsOn: [...task.dependsOn].sort(), requiresEvidence: refs(task.requiresEvidence) })).sort(byId("taskId")),
  });
}

/** Capacity-only draft for a single operator's proposed contiguous work period. No persistence or execution. */
export function buildDailyPlan({ goal, decision, facts, candidates, existingDependencies=[], contextId, now = new Date() } = {}) {
  const started = performance.now();
  const checkBudget = () => { if (performance.now() - started > 60000) reject("BUDGET_EXCEEDED"); };
  if (!object(goal) || !object(decision) || !Array.isArray(facts) || !Array.isArray(candidates) || !(now instanceof Date) || !Number.isFinite(now.getTime())) reject("INVALID_INPUT");
  try { if (!goal.period?.timeZone) reject("INVALID_INPUT"); new Intl.DateTimeFormat("en", { timeZone: goal.period.timeZone }); } catch { reject("INVALID_INPUT"); }
  if (candidates.length > 20) reject("TASK_LIMIT_EXCEEDED");
  if(!Array.isArray(existingDependencies)||existingDependencies.length>100)reject('INVALID_DEPENDENCY');
  const external=new Map(existingDependencies.map(t=>[t.taskId,t]));
  const validation = validateCeoDecision(decision, { goal, facts, now });
  checkBudget();
  if (!text(goal.goalId) || !Array.isArray(goal.targets) || !goal.period?.timeZone) reject("INVALID_INPUT");
  const tasksById = new Map();
  for (const task of candidates) {
    if (!object(task) || !text(task.taskId) || !text(task.actionId) || !text(task.title) || !text(task.acceptance)
        || !object(task.storeRef) || !text(task.storeRef.platform) || !text(task.storeRef.environmentId)
        || !["INVESTIGATION", "ACTION"].includes(task.mode) || !Object.hasOwn(rank, task.priorityClass)
        || !Array.isArray(task.dependsOn) || !task.dependsOn.every(text) || !Array.isArray(task.requiresEvidence)
        || !task.requiresEvidence.every(ref => object(ref) && text(ref.factId) && Number.isSafeInteger(ref.version) && ref.version > 0)) reject("INVALID_TASK");
    if (tasksById.has(task.taskId)) reject("DUPLICATE_TASK");
    if (task.dependsOn.length > 20 || new Set(task.dependsOn).size !== task.dependsOn.length) reject("INVALID_DEPENDENCY");
    if (!Number.isSafeInteger(task.estimatedMinutes) || task.estimatedMinutes <= 0) reject("INVALID_DURATION");
    if (task.deadline !== null && (typeof task.deadline !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(task.deadline) || !Number.isFinite(Date.parse(task.deadline)))) reject("INVALID_DEADLINE");
    tasksById.set(task.taskId, task);
  }
  const visiting = new Set(), visited = new Set(), dependencyOrder = [];
  const visit = id => {
    checkBudget();
    if(!tasksById.has(id)&&external.has(id))return;
    if (visiting.has(id) || !tasksById.has(id)) reject("INVALID_DEPENDENCY");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of tasksById.get(id).dependsOn) visit(dependency);
    visiting.delete(id); visited.add(id); dependencyOrder.push(id);
  };
  for (const id of tasksById.keys()) visit(id);
  const capacity = goal.capacityMinutes, buffer = goal.bufferMinutes;
  if ((capacity != null && (!Number.isSafeInteger(capacity) || capacity < 0))
      || (buffer != null && (!Number.isSafeInteger(buffer) || buffer < 0))
      || (capacity != null && buffer != null && buffer > capacity)) reject("INVALID_CAPACITY");
  const availableMinutes = capacity == null || buffer == null ? null : capacity - buffer;
  const warnings = [...validation.errors];
  if (availableMinutes === null) warnings.push({ code: "CAPACITY_NOT_CONFIRMED", path: "/goal/capacity" });
  const tasks = [], deferred = [], blocked = [], disposition = new Map();
  const factMap = new Map(facts.filter(object).map(fact => [fact.factId, fact]));
  const baseReason = task => {
    if (validation.readiness === "INVALID") return "INVALID_DECISION";
    if (validation.readiness === "NEEDS_CONFIRMATION") return "NEEDS_CONFIRMATION";
    if (decision.conclusion === "NO_ACTION") return "NO_ACTION_SELECTED";
    if (!sameStore(task.storeRef, goal.storeRef)) return "STORE_MISMATCH";
    if (task.actionId !== decision.chosenActionId) return "NOT_SELECTED_ACTION";
    if (validation.readiness === "NEEDS_EVIDENCE" && task.mode !== "INVESTIGATION") return "NEEDS_EVIDENCE";
    if (task.requiresEvidence.some(ref => {
      const fact = factMap.get(ref.factId);
      return !fact || fact.version !== ref.version || fact.quality !== "USABLE" || fact.value === null
        || Date.parse(fact.observedAt) > now.getTime() || !fact.coverage?.complete || fact.coverage?.ratio !== 1 || !sameStore(fact.storeRef, goal.storeRef);
    })) return "MISSING_REQUIRED_EVIDENCE";
    if(task.dependsOn.some(id=>!tasksById.has(id)&&external.has(id)&&!(external.get(id).status==='DONE'&&external.get(id).verification?.accepted===true&&external.get(id).contextId===contextId&&sameStore(external.get(id).definition?.storeRef,goal.storeRef))))return'DEPENDENCY_BLOCKED';
    if (task.deadline && Date.parse(task.deadline) <= now.getTime()) return "DEADLINE_PASSED";
    return null;
  };
  const initialReasons = new Map(candidates.map(task => [task.taskId, baseReason(task)]));
  // A hard milestone lends urgency to its prerequisites instead of starving behind unrelated work.
  const scores = new Map(candidates.map(task => [task.taskId, [rank[task.priorityClass], task.deadline ? Date.parse(task.deadline) : Infinity]]));
  for (const id of [...dependencyOrder].reverse()) {
    checkBudget();
    if (initialReasons.get(id)) continue;
    const score = scores.get(id);
    for (const dependency of tasksById.get(id).dependsOn) {
      checkBudget();
      const own = scores.get(dependency);
      if(!own)continue;
      if (score[0] < own[0] || (score[0] === own[0] && score[1] < own[1])) scores.set(dependency, score);
    }
  }
  const remaining = new Set(tasksById.keys());
  let usedMinutes = 0;
  while (remaining.size) {
    checkBudget();
    const ready = [...remaining].filter(id => tasksById.get(id).dependsOn.every(dependency => !remaining.has(dependency)));
    ready.sort((a, b) => scores.get(a)[0] - scores.get(b)[0] || (scores.get(a)[1] === scores.get(b)[1] ? 0 : scores.get(a)[1] - scores.get(b)[1]) || compareText(a, b));
    const id = ready[0];
    if (!id) reject("INVALID_DEPENDENCY");
    remaining.delete(id);
    const task = tasksById.get(id);
    let reason = initialReasons.get(id), bucket = "blocked";
    if (!reason && task.dependsOn.some(dependency => disposition.get(dependency) === "blocked")) reason = "DEPENDENCY_BLOCKED";
    if (!reason && task.dependsOn.some(dependency => disposition.get(dependency) === "deferred")) { reason = "DEPENDENCY_DEFERRED"; bucket = "deferred"; }
    if (!reason && availableMinutes === null) { reason = "CAPACITY_NOT_CONFIRMED"; bucket = "deferred"; }
    if (!reason && task.deadline && now.getTime() + (usedMinutes + task.estimatedMinutes) * 60000 > Date.parse(task.deadline)) reason = "DEADLINE_UNACHIEVABLE";
    if (!reason && usedMinutes + task.estimatedMinutes > availableMinutes) { reason = "CAPACITY_EXCEEDED"; bucket = "deferred"; }
    if (reason) {
      (bucket === "blocked" ? blocked : deferred).push({ ...task, reason });
      disposition.set(id, bucket);
    } else {
      tasks.push({ ...task }); usedMinutes += task.estimatedMinutes; disposition.set(id, "tasks");
    }
  }
  blocked.sort((a, b) => compareText(a.taskId, b.taskId)); deferred.sort((a, b) => compareText(a.taskId, b.taskId));
  const invalid = ["INVALID", "NEEDS_CONFIRMATION"].includes(validation.readiness);
  const commitment = availableMinutes === null || invalid ? "UNCOMMITTED" : "WITHIN_CAPACITY";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: goal.period.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map(part => [part.type, part.value]));
  const planDate = `${parts.year}-${parts.month}-${parts.day}`;
  const normalized = ["VALIDATED", "NEEDS_EVIDENCE"].includes(validation.readiness)
    ? normalizedInputs(goal, decision, facts, candidates) : canonical({ goal, decision, facts, candidates });
  const usedExternal=[...new Set(candidates.flatMap(t=>t.dependsOn).filter(id=>!tasksById.has(id)&&external.has(id)))].sort().map(id=>{const t=external.get(id);return{taskId:id,version:t.version,status:t.status,contextId:t.contextId,verified:t.verification?.accepted===true};});
  const fingerprint = canonical({ inputs: normalized, planDate, readiness: validation.readiness,
    ...(usedExternal.length?{externalDependencies:usedExternal}:{}),
    allocation: { tasks: tasks.map(task => task.taskId), deferred: deferred.map(task => [task.taskId, task.reason]), blocked: blocked.map(task => [task.taskId, task.reason]) } });
  const planId = `ceo_plan_${createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex").slice(0, 24)}`;
  checkBudget();
  return { schema: "ceo-daily-plan/v1", planId, status: "DRAFT", goalId: goal.goalId, goalVersion: goal.version, decisionId: decision.decisionId,
    commitment, tasks, deferred, blocked, capacity: { availableMinutes, usedMinutes }, warnings };
}
