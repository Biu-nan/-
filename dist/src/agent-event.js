// dist/src/agent-event.js
// 跨 Agent 交接事件：生成 / 校验 / 追加 / 重放 / 哈希链完整性。
// 契约见 schemas/agent-event.schema.json。
//
// 三条不可协商的规则（违反即无效事件，不是警告）：
//   1. 只追加。改错发 CORRECTED，原事件保留不动。
//   2. VERIFIED 不得由发出对应 DELIVERED 的同一个 actor 发出。
//   3. HUMAN_GATE 超时唯一允许行为是 stall，不存在任何自动放行。

import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export const EVENT_TYPES = Object.freeze([
  "INTENT",
  "DELEGATED",
  "ACCEPTED",
  "BLOCKED",
  "HANDOFF",
  "DELIVERED",
  "VERIFIED",
  "REJECTED",
  "HUMAN_GATE",
  "HUMAN_DECISION",
  "CORRECTED",
  "PERMISSION_DENIED",
]);

export const ACTOR_KINDS = Object.freeze(["human", "ceo", "agent", "verifier", "system"]);

export const PAYLOAD_CONTRACT = Object.freeze({
  INTENT: { required: ["goal"] },
  DELEGATED: { required: ["objective", "acceptance", "permissionCeiling"] },
  ACCEPTED: { required: ["eta"] },
  BLOCKED: { required: ["reason", "detail"] },
  HANDOFF: { required: ["ceoConfirmed", "handoffPayload"] },
  DELIVERED: { required: ["artifacts", "selfClaim"] },
  VERIFIED: { required: ["method", "readbackPath", "match"] },
  REJECTED: { required: ["reason", "expected", "actual"] },
  HUMAN_GATE: { required: ["question", "options", "impact", "defaultIfIgnored"] },
  HUMAN_DECISION: { required: ["decision"] },
  CORRECTED: { required: ["correctsEventId", "reason"] },
  PERMISSION_DENIED: { required: ["attempted", "ceiling"] },
});

const TS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function nowIso() {
  return new Date().toISOString();
}

/** 稳定序列化：键排序、剔除 hash 自身，保证同一事件每次算出的摘要一致。 */
export function canonicalize(event) {
  const clone = { ...event };
  delete clone.hash;
  const sortValue = (value) => {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort()
        .reduce((acc, key) => {
          acc[key] = sortValue(value[key]);
          return acc;
        }, {});
    }
    return value;
  };
  return JSON.stringify(sortValue(clone));
}

export function hashEvent(event) {
  return createHash("sha256").update(canonicalize(event)).digest("hex");
}

/**
 * 校验单条事件。跨事件规则（VERIFIED 不得自证）需配合 assertVerifiedNotSelf。
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateEvent(event) {
  const errors = [];
  const push = (msg) => errors.push(msg);

  if (!event || typeof event !== "object") return { ok: false, errors: ["事件不是对象"] };
  if (event.schemaVersion !== "1.0") push(`schemaVersion 必须是 "1.0"，实际 ${event.schemaVersion}`);
  if (typeof event.eventId !== "string" || event.eventId.length < 8) push("eventId 缺失或过短");
  if (typeof event.runId !== "string" || !event.runId) push("runId 缺失");
  if (!Number.isInteger(event.seq) || event.seq < 1) push("seq 必须是 ≥1 的整数");
  if (typeof event.ts !== "string" || !TS_PATTERN.test(event.ts)) push("ts 必须是带时区偏移的 ISO 8601");
  if (!EVENT_TYPES.includes(event.type)) push(`type 非法：${event.type}`);

  for (const slot of ["from", "to"]) {
    const actor = event[slot];
    if (!actor || typeof actor !== "object") {
      push(`${slot} 缺失`);
      continue;
    }
    if (!ACTOR_KINDS.includes(actor.kind)) push(`${slot}.kind 非法：${actor.kind}`);
    if (typeof actor.id !== "string" || !actor.id) push(`${slot}.id 缺失`);
  }

  if (event.prevHash != null && !HASH_PATTERN.test(event.prevHash)) push("prevHash 格式非法");
  if (event.hash != null && !HASH_PATTERN.test(event.hash)) push("hash 格式非法");

  const payload = event.payload ?? {};
  const contract = PAYLOAD_CONTRACT[event.type];
  if (contract) {
    for (const field of contract.required) {
      if (payload[field] === undefined || payload[field] === null) {
        push(`payload.${field} 为 ${event.type} 必填`);
      }
    }
  }

  if (event.type === "DELIVERED" || event.type === "VERIFIED") {
    if (!Array.isArray(event.evidence) || event.evidence.length === 0) {
      push(`${event.type} 必须带至少一条证据，自述不算证据`);
    }
  }

  if (event.type === "HUMAN_GATE") {
    if (event.to?.kind !== "human") push("HUMAN_GATE 的 to.kind 必须是 human");
    if (payload.defaultIfIgnored !== "stall") {
      push(`HUMAN_GATE 的 defaultIfIgnored 只能是 stall，实际 ${payload.defaultIfIgnored}`);
    }
  }

  if (event.type === "HANDOFF" && payload.ceoConfirmed !== true) {
    push("HANDOFF 必须经 CEO 确认，ceoConfirmed 必须为 true");
  }

  if (event.type === "VERIFIED" && event.from?.id === event.to?.id) {
    push(`VERIFIED 的 from 与 to 是同一 id (${event.from?.id})，不能自己核验自己`);
  }

  if (Array.isArray(event.evidence)) {
    event.evidence.forEach((item, index) => {
      if (!item || typeof item !== "object") return push(`evidence[${index}] 不是对象`);
      if (typeof item.ref !== "string" || !item.ref) push(`evidence[${index}].ref 为空，证据必须指向可回读位置`);
      if (item.sha256 != null && !HASH_PATTERN.test(item.sha256)) push(`evidence[${index}].sha256 格式非法`);
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 跨事件规则：取与 VERIFIED 对应的 DELIVERED，确认不是同一个人自证。
 * 判据只看 id，不看 kind —— 同一个实体换个角色标签（agent→verifier）仍是同一个实体，
 * 用 kind 参与比较等于留了后门。
 * @param {object[]} events 同一 run 的全部事件
 * @param {object} verified 待检查的 VERIFIED 事件
 */
export function assertVerifiedNotSelf(events, verified) {
  const parentId = verified?.parentEventId;
  const delivered = parentId
    ? events.find((item) => item.eventId === parentId && item.type === "DELIVERED")
    : [...events].reverse().find((item) => item.type === "DELIVERED");
  if (!delivered) {
    return { ok: false, reason: "VERIFIED 找不到对应的 DELIVERED，不能证明核验对象" };
  }
  if (delivered.from?.id === verified.from?.id) {
    return {
      ok: false,
      reason: `自证：DELIVERED 与 VERIFIED 同为 id=${verified.from?.id}（kind 分别是 ${delivered.from?.kind} / ${verified.from?.kind}，不算不同主体）`,
      deliveredEventId: delivered.eventId,
    };
  }
  return { ok: true, deliveredEventId: delivered.eventId };
}

/**
 * 事件仓库。默认落 data/ceo-operating/events/{runId}.jsonl，一行一事件，只追加。
 * 目录可用 CEO_EVENT_ROOT 覆盖（影子测试必须覆盖，避免污染生产事件）。
 */
export class AgentEventStore {
  constructor({ rootDir } = {}) {
    this.rootDir = rootDir ?? process.env.CEO_EVENT_ROOT ?? path.join(process.cwd(), "data", "ceo-operating", "events");
  }

  fileOf(runId) {
    if (!runId || /[\\/:*?"<>|]/.test(runId)) throw new Error(`runId 非法：${runId}`);
    return path.join(this.rootDir, `${runId}.jsonl`);
  }

  async readRun(runId) {
    try {
      const text = await readFile(this.fileOf(runId), "utf8");
      return text
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  /**
   * 追加一条事件。seq / prevHash / hash 自动补齐，调用方不要自己填。
   * 校验失败直接抛错——无效事件不入库。
   */
  async append({ runId, type, from, to, payload = {}, taskId = null, parentEventId = null, evidence = null, note = null, traceRef = null }) {
    const existing = await this.readRun(runId);
    const last = existing[existing.length - 1];
    const event = {
      schemaVersion: "1.0",
      eventId: randomUUID(),
      runId,
      seq: (last?.seq ?? 0) + 1,
      ts: nowIso(),
      type,
      from,
      to,
      taskId,
      parentEventId,
      evidence,
      payload,
      note,
      traceRef,
      prevHash: last?.hash ?? null,
    };
    event.hash = hashEvent(event);

    const verdict = validateEvent(event);
    if (!verdict.ok) {
      const error = new Error(`EVENT_INVALID: ${verdict.errors.join("; ")}`);
      error.code = "EVENT_INVALID";
      error.errors = verdict.errors;
      throw error;
    }
    if (type === "VERIFIED") {
      const crossCheck = assertVerifiedNotSelf([...existing, event], event);
      if (!crossCheck.ok) {
        const error = new Error(`SELF_VERIFICATION_DENIED: ${crossCheck.reason}`);
        error.code = "SELF_VERIFICATION_DENIED";
        throw error;
      }
    }

    await mkdir(path.dirname(this.fileOf(runId)), { recursive: true });
    await appendFile(this.fileOf(runId), `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  /**
   * 哈希链与序号完整性。任何一条被改写、删除、插入都会在这里暴露。
   */
  async verifyChain(runId) {
    const events = await this.readRun(runId);
    const problems = [];
    let prevHash = null;
    events.forEach((event, index) => {
      const expectedSeq = index + 1;
      if (event.seq !== expectedSeq) problems.push(`第 ${index + 1} 条 seq=${event.seq}，期望 ${expectedSeq}（疑似缺失或乱序）`);
      if (event.prevHash !== prevHash) problems.push(`第 ${index + 1} 条 prevHash 与上一条 hash 不衔接（疑似删改或插入）`);
      if (hashEvent(event) !== event.hash) problems.push(`第 ${index + 1} 条内容与自身 hash 不符（疑似被改写）`);
      const verdict = validateEvent(event);
      if (!verdict.ok) problems.push(`第 ${index + 1} 条不合约：${verdict.errors.join("; ")}`);
      prevHash = event.hash;
    });
    return { ok: problems.length === 0, count: events.length, problems };
  }

  /** 列出所有 run，按最新事件时间倒序。 */
  async listRuns() {
    let entries = [];
    try {
      entries = await readdir(this.rootDir);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    const runs = entries.filter((name) => name.endsWith(".jsonl")).map((name) => name.slice(0, -6));
    const rows = [];
    for (const runId of runs) {
      const events = await this.readRun(runId);
      const last = events[events.length - 1];
      rows.push({ runId, count: events.length, lastTs: last?.ts ?? null, lastType: last?.type ?? null });
    }
    return rows.sort((a, b) => String(b.lastTs ?? "").localeCompare(String(a.lastTs ?? "")));
  }

  /**
   * 建索引。按 taskId 与按 agentId 双向可查，回答"这个任务经历过哪些交接""这个 Agent 都干了什么"。
   * 索引是派生物，随时可从 jsonl 重建，不单独持久化——避免出现第二份真相。
   */
  async buildIndex({ runIds } = {}) {
    const targets = runIds ?? (await this.listRuns()).map((row) => row.runId);
    const byTask = new Map();
    const byAgent = new Map();
    const byRun = new Map();

    for (const runId of targets) {
      const events = await this.readRun(runId);
      byRun.set(runId, events);
      for (const event of events) {
        if (event.taskId) {
          if (!byTask.has(event.taskId)) byTask.set(event.taskId, []);
          byTask.get(event.taskId).push(event);
        }
        for (const actor of [event.from, event.to]) {
          const key = actor ? `${actor.kind}:${actor.id}` : null;
          if (!key) continue;
          if (!byAgent.has(key)) byAgent.set(key, []);
          byAgent.get(key).push(event);
        }
      }
    }
    return {
      runs: targets,
      byTask,
      byAgent,
      byRun,
      findTask: (taskId) => byTask.get(taskId) ?? [],
      findAgent: (agentId) => byAgent.get(agentId) ?? [],
      timelineOf: (runId) => projectRunToTimeline(byRun.get(runId) ?? []),
    };
  }
}

/**
 * 把一条 run 的事件投影成群聊消息。纯读，不写。
 * 群聊只是视图：改这里不会影响任何真相，真相永远是 jsonl。
 */
export function projectRunToTimeline(events) {
  return events.map((event) => ({
    seq: event.seq,
    ts: event.ts,
    type: event.type,
    from: `${event.from.kind}:${event.from.id}`,
    to: `${event.to.kind}:${event.to.id}`,
    summary: summarizePayload(event),
    evidenceCount: Array.isArray(event.evidence) ? event.evidence.length : 0,
    taskId: event.taskId,
    eventId: event.eventId,
    parentEventId: event.parentEventId,
  }));
}

function summarizePayload(event) {
  const payload = event.payload ?? {};
  switch (event.type) {
    case "INTENT":
      return payload.goal ?? "";
    case "DELEGATED":
      return payload.objective ?? "";
    case "ACCEPTED":
      return `受理，预计 ${payload.eta ?? "未给"}`;
    case "BLOCKED":
      return `${payload.reason}: ${payload.detail ?? ""}`;
    case "DELIVERED":
      return payload.selfClaim ?? "";
    case "VERIFIED":
      return `回读通过（${payload.method ?? "未注明方法"}）`;
    case "REJECTED":
      return `不通过：期望 ${payload.expected ?? "?"}，实际 ${payload.actual ?? "?"}`;
    case "HUMAN_GATE":
      return payload.question ?? "";
    case "HUMAN_DECISION":
      return payload.decision ?? "";
    default:
      return payload.reason ?? payload.note ?? "";
  }
}
