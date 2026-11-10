import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateShape = ajv.compile(JSON.parse(readFileSync(new URL("../../schemas/ceo-decision.schema.json", import.meta.url), "utf8")));
const PROFIT_TARGET = "monthly-operating-profit-ex-quality-penalty";
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.trim().length > 0;
const version = value => Number.isSafeInteger(value) && value > 0;
const timestamp = value => text(value) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
const sameStore = (a, b) => a?.platform === b?.platform && a?.environmentId === b?.environmentId;
const store = value => object(value) && text(value.platform) && text(value.environmentId);
const referenceKey = value => JSON.stringify([value.factId, value.version]);
const period = value => object(value) && timestamp(value.start) && timestamp(value.end) && Date.parse(value.start) < Date.parse(value.end);
const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function nextDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function fitsWindow(value, target, goalPeriod) {
  if (!period(value)) return false;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: goalPeriod.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const local = time => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(time)).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, midnight: parts.hour === "00" && parts.minute === "00" && parts.second === "00" };
  };
  const start = local(value.start), end = local(value.end);
  if (!start.midnight || !end.midnight || start.date < goalPeriod.fromDate || end.date > nextDate(goalPeriod.toDate)) return false;
  if (target.window === "DAY") return nextDate(start.date) === end.date;
  const nextMonth = new Date(`${start.date}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1);
  return start.date.endsWith("-01") && nextMonth.toISOString().slice(0, 10) === end.date;
}

function observationPending(claim, target, goalPeriod, now) {
  if (claim.claimType !== "TARGET_ASSESSMENT") return false;
  if (claim.period !== null) return fitsWindow(claim.period, target, goalPeriod) && Date.parse(claim.period.end) > now.getTime();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: goalPeriod.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return date < goalPeriod.fromDate || (target.window === "MONTH" && date <= goalPeriod.toDate);
}

function validFact(fact) {
  return object(fact) && text(fact.factId) && version(fact.version) && store(fact.storeRef)
    && text(fact.caliber) && text(fact.unit) && (fact.value === null || (typeof fact.value === "number" && Number.isFinite(fact.value)))
    && period(fact.period) && timestamp(fact.observedAt) && ["USABLE", "INCOMPLETE"].includes(fact.quality)
    && object(fact.coverage) && typeof fact.coverage.complete === "boolean"
    && typeof fact.coverage.ratio === "number" && fact.coverage.ratio >= 0 && fact.coverage.ratio <= 1;
}

/** Validate draft consistency against caller-supplied authoritative goal/facts. Never authorizes or executes an action. */
export function validateCeoDecision(decision, { goal, facts, now = new Date() } = {}) {
  const issues = [];
  const add = (level, code, path) => {
    if (!issues.some(item => item.code === code && item.path === path)) issues.push({ level, code, path });
  };
  const result = () => {
    const readiness = issues.some(i => i.level === "INVALID") ? "INVALID"
      : issues.some(i => i.level === "CONFIRM") ? "NEEDS_CONFIRMATION"
        : issues.length ? "NEEDS_EVIDENCE" : "VALIDATED";
    return { ok: readiness === "VALIDATED", readiness, errors: issues.map(({ code, path }) => ({ code, path })) };
  };
  if (!object(goal) || !text(goal.goalId) || !Array.isArray(goal.targets) || !goal.targets.length) {
    add("CONFIRM", "MISSING_GOAL", "/goal"); return result();
  }
  let validZone = false;
  try { new Intl.DateTimeFormat("en", { timeZone: goal.period?.timeZone }); validZone = text(goal.period?.timeZone); } catch { /* invalid zone */ }
  if (goal.schema !== "ceo-goal/v1" || !version(goal.version) || !store(goal.storeRef)
      || !validZone || !validDate(goal.period?.fromDate) || !validDate(goal.period?.toDate) || goal.period.fromDate > goal.period.toDate
      || !(now instanceof Date) || !Number.isFinite(now.getTime()) || !Array.isArray(facts) || facts.length > 200 || !facts.every(validFact)) {
    add("INVALID", "INVALID_CONTEXT", "/context"); return result();
  }
  const targets = new Map();
  for (const target of goal.targets) {
    if (!object(target) || !text(target.targetId) || targets.has(target.targetId) || !["DAY", "MONTH"].includes(target.window)) {
      add("INVALID", "INVALID_CONTEXT", "/goal/targets"); continue;
    }
    targets.set(target.targetId, target);
    if (typeof target.value !== "number" || !Number.isFinite(target.value) || !text(target.unit)) add("CONFIRM", "MISSING_TARGET_DEFINITION", `/goal/targets/${target.targetId}`);
    if (target.metricStatus !== "VERIFIED" || !text(target.caliber)) add("EVIDENCE", "METRIC_UNVERIFIED", `/goal/targets/${target.targetId}`);
    if (target.targetId === PROFIT_TARGET && target.caliber === "sales.amount.net") add("INVALID", "CALIBER_MISMATCH", `/goal/targets/${target.targetId}/caliber`);
    if (target.targetId === "daily-paid-items" && target.caliber && target.caliber !== "sales.qty.total") add("INVALID", "CALIBER_MISMATCH", `/goal/targets/${target.targetId}/caliber`);
  }
  if (issues.some(i => i.level === "INVALID")) return result();
  if (!validateShape(decision)) {
    for (const error of validateShape.errors || []) add("INVALID", "INVALID_DECISION", error.instancePath || "/decision");
    return result();
  }
  if (decision.goalId !== goal.goalId) add("INVALID", "GOAL_MISMATCH", "/goalId");
  if (decision.goalVersion !== goal.version) add("INVALID", "STALE_GOAL", "/goalVersion");
  if (!sameStore(decision.storeRef, goal.storeRef)) add("INVALID", "STORE_MISMATCH", "/storeRef");
  if (decision.policyVersion !== "ceo-policy/v1") add("INVALID", "UNSUPPORTED_POLICY", "/policyVersion");
  if (!timestamp(decision.reviewAt)) add("INVALID", "INVALID_DECISION", "/reviewAt");
  else if (Date.parse(decision.reviewAt) <= now.getTime()) add("INVALID", "EXPIRED_DECISION", "/reviewAt");
  if (goal.deadline != null && !timestamp(goal.deadline)) add("INVALID", "INVALID_CONTEXT", "/goal/deadline");

  const ids = new Set(), descriptions = new Set();
  for (const option of decision.options) {
    const description = option.description.trim().toLowerCase();
    if (ids.has(option.actionId) || descriptions.has(description)) add("INVALID", "DUPLICATE_OPTION", "/options");
    ids.add(option.actionId); descriptions.add(description);
  }
  if (decision.conclusion === "NO_ACTION") {
    if (decision.chosenActionId !== null) add("INVALID", "UNKNOWN_ACTION", "/chosenActionId");
  } else if (!ids.has(decision.chosenActionId)) add("INVALID", "UNKNOWN_ACTION", "/chosenActionId");
  for (const targetId of decision.affectsTargets) if (!targets.has(targetId)) add("INVALID", "UNKNOWN_TARGET", "/affectsTargets");

  const factMap = new Map();
  for (const fact of facts) {
    if (factMap.has(fact.factId)) add("INVALID", "AMBIGUOUS_FACT", `/facts/${fact.factId}`);
    factMap.set(fact.factId, fact);
  }
  const resolve = (ref, path) => {
    const fact = factMap.get(ref.factId);
    if (!fact) { add("INVALID", "UNKNOWN_FACT", path); return null; }
    if (fact.version !== ref.version) { add("INVALID", "STALE_FACT", path); return null; }
    if (!sameStore(fact.storeRef, goal.storeRef)) add("INVALID", "STORE_MISMATCH", path);
    if (Date.parse(fact.observedAt) > now.getTime()) add("INVALID", "FACT_FROM_FUTURE", path);
    if (fact.quality !== "USABLE" || fact.value === null || !fact.coverage.complete || fact.coverage.ratio < 1) add("EVIDENCE", "INCOMPLETE_FACT", path);
    return fact;
  };
  const declared = new Set(decision.evidenceRefs.map(referenceKey));
  decision.evidenceRefs.forEach((ref, index) => resolve(ref, `/evidenceRefs/${index}`));
  const assessed = new Set(), claimIds = new Set();
  let pendingObservation = false;
  for (const [index, claim] of decision.claims.entries()) {
    const claimPath = `/claims/${index}`, target = targets.get(claim.targetId);
    if (claimIds.has(claim.claimId)) add("INVALID", "DUPLICATE_CLAIM", claimPath);
    claimIds.add(claim.claimId);
    if (!target) { add("INVALID", "UNKNOWN_TARGET", claimPath); continue; }
    if (claim.claimType === "TARGET_ASSESSMENT") assessed.add(claim.targetId);
    if (claim.verdict === "INSUFFICIENT_EVIDENCE") add("EVIDENCE", "INSUFFICIENT_EVIDENCE", claimPath);
    if (claim.verdict === "PENDING_OBSERVATION") {
      pendingObservation = true;
      if (!observationPending(claim, target, goal.period, now)) add("INVALID", "OBSERVATION_ALREADY_DUE", claimPath);
    }
    if (claim.claimType === "ACTION_BASIS" && claim.actionId !== decision.chosenActionId) add("INVALID", "UNSELECTED_ACTION_BASIS", claimPath);
    if (claim.verdict === "SUPPORTED" && (!text(claim.caliber) || !text(claim.unit) || !period(claim.period))) add("INVALID", "INVALID_DECISION", claimPath);
    if (claim.claimType === "TARGET_ASSESSMENT" && claim.verdict === "SUPPORTED") {
      if ((target.caliber && claim.caliber !== target.caliber) || (target.unit && claim.unit !== target.unit)) add("INVALID", "CALIBER_MISMATCH", claimPath);
      if (!fitsWindow(claim.period, target, goal.period)) add("INVALID", "WINDOW_MISMATCH", claimPath);
      if (!claim.evidenceBindings.some(binding => binding.role === "PRIMARY_METRIC")) add("EVIDENCE", "MISSING_PRIMARY_EVIDENCE", claimPath);
    }
    if (claim.claimType === "ACTION_BASIS" && claim.verdict === "SUPPORTED" && !claim.evidenceBindings.some(binding => binding.role === "PRIMARY_METRIC")) add("EVIDENCE", "MISSING_PRIMARY_EVIDENCE", claimPath);
    if (claim.verdict === "SUPPORTED" && !claim.evidenceBindings.length) add("EVIDENCE", "INSUFFICIENT_EVIDENCE", claimPath);
    for (const [bindingIndex, binding] of claim.evidenceBindings.entries()) {
      const bindingPath = `${claimPath}/evidenceBindings/${bindingIndex}`;
      if (!declared.has(referenceKey(binding))) add("INVALID", "UNDECLARED_REFERENCE", bindingPath);
      const fact = resolve(binding, bindingPath);
      if (!fact || binding.role !== "PRIMARY_METRIC") continue;
      if (fact.caliber !== claim.caliber || fact.unit !== claim.unit) add("INVALID", "CALIBER_MISMATCH", bindingPath);
      if (!period(claim.period) || Date.parse(fact.period.start) !== Date.parse(claim.period.start) || Date.parse(fact.period.end) !== Date.parse(claim.period.end)) add("INVALID", "WINDOW_MISMATCH", bindingPath);
      if (claim.targetId === PROFIT_TARGET) {
        if (fact.coverage.costsReconciled !== true) add("EVIDENCE", "COSTS_UNRECONCILED", bindingPath);
        if (fact.coverage.qualityPenaltiesExcluded !== true) add("EVIDENCE", "QUALITY_PENALTY_UNCONFIRMED", bindingPath);
      }
    }
  }
  if (pendingObservation && decision.conclusion !== "NO_ACTION" && !decision.claims.some(claim => claim.claimType === "ACTION_BASIS" && claim.verdict === "SUPPORTED" && claim.actionId === decision.chosenActionId && claim.evidenceBindings.some(binding => binding.role === "PRIMARY_METRIC"))) add("EVIDENCE", "MISSING_ACTION_BASIS", "/claims");
  for (const targetId of targets.keys()) if (!assessed.has(targetId)) add("INVALID", "MISSING_TARGET_ASSESSMENT", "/claims");
  if (decision.conclusion === "INSUFFICIENT_EVIDENCE") add("EVIDENCE", "INSUFFICIENT_EVIDENCE", "/conclusion");
  return result();
}
