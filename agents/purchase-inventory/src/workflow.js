// agents/purchase-inventory/src/workflow.js
// 库存与采购 Workflow（D2）：把一次补货判断完整跑成一条可追溯的事件流。
//
// 事件链（顺序固定）：
//   INTENT      human → ceo     立项
//   DELEGATED   ceo   → agent   派活（含权限上限）
//   ACCEPTED    agent → ceo     接单
//   ── 预检不过 ──→ BLOCKED     停在这里，不硬出结论
//   DELIVERED   agent → ceo     交付产物（带文件哈希）
//   HUMAN_GATE  agent → human   仅 RESTOCK 时开闸，默认 stall
//   HUMAN_DECISION human → agent
//   VERIFIED / REJECTED  verifier → agent（独立回读，不复用交付方路径）
//
// 三条不可让步的规则：
//   ① 产物必须落盘，核验方从磁盘按哈希回读——不能拿内存对象比内存对象；
//   ② 核验方 id 必须与交付方不同，换 kind 不算换主体；
//   ③ HUMAN_GATE 的 defaultIfIgnored 只能是 stall，没人批就一直等。

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { AgentEventStore } from "../../../dist/src/agent-event.js";
import { VerificationChannel, defaultReaders } from "../../../dist/src/verification-channel.js";
import { runOne } from "./engine.js";
import { loadLimits } from "./limits.js";

const sha256OfBuffer = (buffer) => createHash("sha256").update(buffer).digest("hex");

export const DEFAULT_ACTORS = Object.freeze({
  human: Object.freeze({ kind: "human", id: "lance" }),
  ceo: Object.freeze({ kind: "ceo", id: "ceo" }),
  agent: Object.freeze({ kind: "agent", id: "purchase-inventory" }),
  verifier: Object.freeze({ kind: "verifier", id: "inventory-verifier" }),
});

function newRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `pi-${stamp}-${randomUUID().slice(0, 6)}`;
}

async function writeArtifact(file, value) {
  const buffer = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buffer);
  const info = await stat(file);
  return { kind: "file", ref: file, sha256: sha256OfBuffer(buffer), bytes: info.size };
}

/**
 * 跑一次库存与采购流程。
 * @param {object} opts
 * @param {string} opts.storeId
 * @param {string} opts.asOf
 * @param {object} opts.calibers
 * @param {number} opts.historyDays
 * @param {number} [opts.cumulativeSalesBefore30d]
 * @param {string} [opts.transitCollectedAt]
 * @param {string} [opts.skuId]
 * @param {object} [opts.params]
 * @param {"approve"|"reject"|null} [opts.decision]  HUMAN_GATE 的答复；不给就停在等人
 * @param {string} [opts.eventRoot]     事件根目录
 * @param {string} [opts.artifactRoot]  产物根目录
 * @param {object} [opts.actors]        覆盖默认身份
 * @param {string} [opts.runId]
 */
export async function runPurchaseWorkflow(opts = {}) {
  const {
    storeId = "400370",
    asOf,
    calibers,
    historyDays,
    cumulativeSalesBefore30d = 0,
    transitCollectedAt = null,
    skuId,
    params = {},
    decision = null,
    eventRoot = path.join(process.cwd(), "data", "ceo-operating", "events"),
    artifactRoot,
    actors = DEFAULT_ACTORS,
    runId = newRunId(),
  } = opts;

  if (!asOf) throw new Error("asOf 必填");
  if (!calibers) throw new Error("calibers 必填");

  const a = { ...DEFAULT_ACTORS, ...actors };
  if (a.verifier.id === a.agent.id) {
    throw new Error("核验方与执行方不能是同一个 id —— 换个 kind 不算换了主体");
  }

  const store = new AgentEventStore({ rootDir: eventRoot });
  const taskId = `task-${runId}`;
  const artDir = artifactRoot ?? path.join(path.dirname(eventRoot), "purchase-inventory", runId);
  const events = [];
  const emit = async (args) => {
    const event = await store.append({ runId, taskId, ...args });
    events.push(event);
    return event;
  };

  // 1. 立项
  await emit({
    type: "INTENT",
    from: a.human,
    to: a.ceo,
    payload: {
      goal: `判断店铺 ${storeId} 在 ${asOf} 是否需要补货，需则给出建议件数`,
      storeId,
      asOf,
    },
  });

  // 2. 派活（把权限上限写进事件，不靠口头约定）
  const limits = await loadLimits();
  await emit({
    type: "DELEGATED",
    from: a.ceo,
    to: a.agent,
    payload: {
      objective: "读快照 → 算覆盖天数 → 出补货建议或明确不补",
      acceptance: "11 条用例全过；口径缺失/日切窗口必须 fail-closed；金额字段一律禁止",
      permissionCeiling: {
        sideEffect: limits.sideEffect.allowed,
        maxSuggestPerSku: limits.quantity.maxSuggestPerSku,
        maxTotalPerOrder: limits.quantity.maxTotalPerOrder,
        moneyOutput: limits.money.outputAllowed,
      },
    },
  });

  // 3. 接单
  await emit({
    type: "ACCEPTED",
    from: a.agent,
    to: a.ceo,
    payload: { eta: "PT2S" },
  });

  // 4. 预检 + 判定
  const result = await runOne(
    {
      storeId,
      asOf,
      calibers,
      historyDays,
      cumulativeSalesBefore30d,
      transitCollectedAt,
      skuId,
      params,
    },
    limits,
  );

  if (result.status !== "OK") {
    // 预检不过就停，不硬出一个"看起来合理"的建议
    await emit({
      type: "BLOCKED",
      from: a.agent,
      to: a.ceo,
      payload: {
        reason: result.code ?? "PRECHECK_FAILED",
        detail: (result.violations ?? []).map((v) => `${v.code ?? ""} ${v.detail ?? ""}`.trim()).join("；") || "预检未通过",
        missing: result.missing ?? [],
      },
    });
    return { runId, status: "BLOCKED", code: result.code, events, verdict: null, artifacts: [] };
  }

  // 5. 产物落盘（核验要靠磁盘上的字节，不是内存里的对象）
  const auditPayload = {
    schema: "purchase-inventory/audit/v1",
    storeId,
    asOf,
    collectedAt: transitCollectedAt,
    calibers,
    derived: { physicalAvailable: result.physicalAvailable },
  };
  const artifacts = [
    await writeArtifact(path.join(artDir, "suggestion.json"), result.batch),
    await writeArtifact(path.join(artDir, "audit.json"), auditPayload),
  ];

  const delivered = await emit({
    type: "DELIVERED",
    from: a.agent,
    to: a.ceo,
    payload: {
      artifacts,
      selfClaim: `${result.verdict}：${result.reason}`,
    },
    evidence: artifacts,
    note: `结论 ${result.verdict}，产物 ${artifacts.length} 个`,
  });

  // 6. 独立核验：换一个 id，从磁盘回读比哈希。
  //    顺序必须在开闸之前 —— 不能让人去批准一个还没验过的东西。
  const channel = new VerificationChannel({
    store,
    readers: defaultReaders(),
    verifier: a.verifier,
  });
  const verification = await channel.verifyDelivered({
    runId,
    deliveredEventId: delivered.eventId,
    taskId,
  });
  events.push(verification.event);

  if (verification.verdict !== "VERIFIED") {
    // 交付物对不上，就不该再问人要不要下单。停在这里。
    return {
      runId,
      status: "REJECTED",
      verdict: result.verdict,
      reason: result.reason,
      events,
      artifacts,
      gate: null,
      verify: verification,
    };
  }

  // 7. HUMAN_GATE：只有真要下单才开闸
  let gate = null;
  if (result.gate?.required) {
    gate = await emit({
      type: "HUMAN_GATE",
      from: a.agent,
      to: a.human,
      payload: {
        question: result.gate.question,
        options: ["approve", "reject"],
        impact: `按建议补 ${Math.max(0, result.rawSuggestQty)} 件${
          result.onViolation ? `（超单 SKU 上限，需拆 ${result.splitInto} 单逐单确认）` : ""
        }`,
        defaultIfIgnored: "stall",
      },
      parentEventId: delivered.eventId,
      evidence: artifacts.slice(0, 1),
    });

    if (!decision) {
      // 没人批就一直等。不超时放行，不猜。
      return {
        runId,
        status: "WAITING_HUMAN",
        verdict: result.verdict,
        reason: result.reason,
        events,
        artifacts,
        gate,
        verify: verification,
      };
    }

    await emit({
      type: "HUMAN_DECISION",
      from: a.human,
      to: a.agent,
      payload: { decision, gateEventId: gate.eventId },
      parentEventId: gate.eventId,
    });
  }

  return {
    runId,
    status: "VERIFIED",
    verdict: result.verdict,
    reason: result.reason,
    events,
    artifacts,
    gate,
    verify: verification,
    decision,
  };
}

/** 读回一条 run 的全部事件并校验哈希链。 */
export async function readWorkflowRun({ runId, eventRoot }) {
  const store = new AgentEventStore({ rootDir: eventRoot });
  const events = await store.readRun(runId);
  const chain = await store.verifyChain(runId);
  return { events, chain };
}

/**
 * 对一条停在 HUMAN_GATE 的 run 补一个批复，然后继续核验。
 *
 * 为什么必须有这个函数：Gate 的 defaultIfIgnored 是 stall，意思是"没人批就一直等"。
 * 进程退出后再批是常态，不是异常。如果只能在启动时把 decision 传进去，
 * 那"等人"就变成了"必须人在场"，stall 语义就是假的。
 */
export async function resumeDecision({ runId, decision, eventRoot, actors = DEFAULT_ACTORS } = {}) {
  if (!runId) throw new Error("runId 必填");
  if (!["approve", "reject"].includes(decision)) throw new Error(`decision 只能是 approve/reject，实际 ${decision}`);

  const a = { ...DEFAULT_ACTORS, ...actors };
  const store = new AgentEventStore({ rootDir: eventRoot ?? path.join(process.cwd(), "data", "ceo-operating", "events") });

  const chain = await store.verifyChain(runId);
  if (!chain.ok) {
    const error = new Error(`CHAIN_BROKEN: ${chain.problems.join("; ")}`);
    error.code = "CHAIN_BROKEN";
    error.problems = chain.problems;
    throw error;
  }

  const events = await store.readRun(runId);
  const gate = [...events].reverse().find((e) => e.type === "HUMAN_GATE");
  if (!gate) {
    const error = new Error(`NO_GATE: run ${runId} 里没有 HUMAN_GATE，不需要批复`);
    error.code = "NO_GATE";
    throw error;
  }
  if (events.some((e) => e.type === "HUMAN_DECISION" && e.parentEventId === gate.eventId)) {
    const error = new Error(`ALREADY_DECIDED: gate ${gate.eventId} 已经有批复，不重复记`);
    error.code = "ALREADY_DECIDED";
    throw error;
  }
  const delivered = events.find((e) => e.eventId === gate.parentEventId && e.type === "DELIVERED");
  if (!delivered) {
    const error = new Error(`GATE_WITHOUT_DELIVERED: gate ${gate.eventId} 找不到对应的 DELIVERED`);
    error.code = "GATE_WITHOUT_DELIVERED";
    throw error;
  }

  // 等待期间产物可能被人动过。批之前必须再验一次——
  // 让人批准一份已经被改过的东西，比直接拒绝更糟。
  const channel = new VerificationChannel({ store, readers: defaultReaders(), verifier: a.verifier });
  const reverification = await channel.verifyDelivered({
    runId,
    deliveredEventId: delivered.eventId,
    taskId: gate.taskId,
  });
  if (reverification.verdict !== "VERIFIED") {
    const error = new Error(
      `ARTIFACTS_CHANGED: 等待期间交付物与交付时不符，拒绝记录批复（${reverification.mismatches?.length ?? 0} 项不一致）`,
    );
    error.code = "ARTIFACTS_CHANGED";
    error.mismatches = reverification.mismatches ?? [];
    throw error;
  }

  const decisionEvent = await store.append({
    runId,
    taskId: gate.taskId,
    type: "HUMAN_DECISION",
    from: a.human,
    to: a.agent,
    payload: { decision, gateEventId: gate.eventId },
    parentEventId: gate.eventId,
    note: `人工${decision === "approve" ? "同意" : "驳回"}（续批）`,
  });

  return {
    runId,
    decision,
    decisionEvent,
    reverify: reverification,
    status: reverification.verdict === "VERIFIED" ? "VERIFIED" : "REJECTED",
  };
}

/** 从磁盘重新读一个产物并算哈希，用于外部抽查。 */
export async function rehashArtifact(ref) {
  const buffer = await readFile(ref);
  return { ref, sha256: sha256OfBuffer(buffer), bytes: buffer.length };
}
