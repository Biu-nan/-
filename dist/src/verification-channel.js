// dist/src/verification-channel.js
// 独立核验通道：把 DELIVERED 的声明拿去做独立回读，比对通过才发 VERIFIED，不通过发 REJECTED。
//
// 为什么单独一个模块：核验必须与执行分离。执行方自己说"成功了"是自证，
// 只有换一条路径把结果读回来、且内容哈希对得上，才算证据。
//
// 三条硬约束：
//   1. readers 由调用方注入，核验方不得复用执行方的读取路径。
//   2. 比对依据是 sha256，不是"文件存在"或"接口 200"。
//   3. 任何一项不一致即判 REJECTED，不允许"部分通过"。

import { createHash } from "node:crypto";

export function sha256Of(input) {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * 默认 readers。只覆盖可独立回读的来源；db-row 这类需要业务知识，由调用方注入。
 * 每个 reader 返回 { sha256, bytes } 或抛错。
 */
export function defaultReaders() {
  return {
    async file(ref) {
      const { readFile, stat } = await import("node:fs/promises");
      const buffer = await readFile(ref);
      const info = await stat(ref);
      return { sha256: sha256Of(buffer), bytes: info.size };
    },
    async jsonl(ref) {
      return this.file(ref);
    },
    async screenshot(ref) {
      return this.file(ref);
    },
    async http(ref) {
      const response = await fetch(ref, { method: "GET" });
      if (!response.ok) throw new Error(`HTTP ${response.status} @ ${ref}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      return { sha256: sha256Of(buffer), bytes: buffer.length };
    },
    async hash(ref) {
      const value = String(ref).trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`hash ref 不是合法 sha256：${ref}`);
      return { sha256: value, bytes: null };
    },
  };
}

/**
 * 逐个回读产物并与声明比对。
 * @returns {{ok:boolean, checks:object[], mismatches:object[]}}
 */
export async function readbackArtifacts(artifacts, readers) {
  const checks = [];
  const mismatches = [];

  for (const [index, artifact] of (artifacts ?? []).entries()) {
    const label = `artifacts[${index}]`;
    if (!artifact || typeof artifact !== "object") {
      mismatches.push({ label, reason: "产物项不是对象" });
      continue;
    }
    const kind = artifact.kind ?? "file";
    const ref = artifact.ref;
    if (!ref) {
      mismatches.push({ label, reason: "产物缺 ref，无法回读" });
      continue;
    }
    const reader = readers[kind];
    if (typeof reader !== "function") {
      mismatches.push({ label, ref, reason: `没有 ${kind} 类型的回读器，不能证明该产物存在` });
      continue;
    }

    let actual;
    try {
      actual = await reader(ref);
    } catch (error) {
      checks.push({ label, ref, kind, status: "READBACK_FAILED", error: error?.message ?? String(error) });
      mismatches.push({ label, ref, reason: `回读失败：${error?.message ?? error}` });
      continue;
    }

    const declared = artifact.sha256 ?? null;
    const declaredBytes = artifact.bytes ?? null;

    if (declared == null) {
      // 声明里没给哈希：能回读但无法证明"读到的就是交付的那个"，按不通过处理。
      checks.push({ label, ref, kind, status: "HASH_NOT_DECLARED", actualSha256: actual.sha256, actualBytes: actual.bytes });
      mismatches.push({
        label,
        ref,
        reason: "DELIVERED 未声明 sha256，回读内容无法与交付物对应",
        actual: actual.sha256,
        expected: null,
      });
      continue;
    }

    if (declared !== actual.sha256) {
      checks.push({ label, ref, kind, status: "CONTENT_MISMATCH", declaredSha256: declared, actualSha256: actual.sha256 });
      mismatches.push({ label, ref, reason: "内容哈希不一致", expected: declared, actual: actual.sha256 });
      continue;
    }

    if (declaredBytes != null && actual.bytes != null && Number(declaredBytes) !== Number(actual.bytes)) {
      checks.push({ label, ref, kind, status: "BYTES_MISMATCH", declaredBytes, actualBytes: actual.bytes });
      mismatches.push({ label, ref, reason: "字节数不一致", expected: String(declaredBytes), actual: String(actual.bytes) });
      continue;
    }

    checks.push({ label, ref, kind, status: "MATCH", sha256: actual.sha256, bytes: actual.bytes });
  }

  return { ok: mismatches.length === 0 && checks.length > 0, checks, mismatches };
}

/**
 * 独立核验通道。核验方的身份由构造时固定，调用方不得中途替换。
 */
export class VerificationChannel {
  constructor({ store, readers, verifier }) {
    if (!store) throw new Error("必须提供 store");
    if (!verifier || verifier.kind !== "verifier") {
      throw new Error("verifier 的 kind 必须是 verifier，执行方不得充当核验方");
    }
    this.store = store;
    this.readers = { ...defaultReaders(), ...(readers ?? {}) };
    this.verifier = verifier;
  }

  /**
   * 核验一条 DELIVERED。
   * 通过 → 追加 VERIFIED；不通过 → 追加 REJECTED。两者都带证据。
   */
  async verifyDelivered({ runId, deliveredEventId, taskId = null, method = "independent-readback" }) {
    const events = await this.store.readRun(runId);
    const delivered = events.find((event) => event.eventId === deliveredEventId);
    if (!delivered) throw new Error(`找不到 DELIVERED：${deliveredEventId}`);
    if (delivered.type !== "DELIVERED") throw new Error(`事件 ${deliveredEventId} 类型是 ${delivered.type}，不是 DELIVERED`);
    if (delivered.from?.id === this.verifier.id) {
      throw new Error(
        `核验方与交付方是同一个实体（id=${this.verifier.id}），换个 kind 不算换了主体，拒绝自证`,
      );
    }

    const artifacts = delivered.payload?.artifacts ?? [];
    const result = await readbackArtifacts(artifacts, this.readers);

    const base = {
      runId,
      taskId: taskId ?? delivered.taskId ?? null,
      from: this.verifier,
      to: delivered.from,
      parentEventId: delivered.eventId,
    };

    if (result.ok) {
      const event = await this.store.append({
        ...base,
        type: "VERIFIED",
        payload: {
          method,
          readbackPath: artifacts.map((item) => item?.ref).join(" | "),
          match: true,
          checks: result.checks,
        },
        evidence: artifacts.map((item) => ({
          kind: item?.kind ?? "file",
          ref: item?.ref,
          sha256: item?.sha256 ?? null,
          bytes: item?.bytes ?? null,
        })),
        note: `独立回读 ${result.checks.length} 项全部一致`,
      });
      return { verdict: "VERIFIED", event, checks: result.checks };
    }

    const event = await this.store.append({
      ...base,
      type: "REJECTED",
      payload: {
        reason: "READBACK_MISMATCH",
        expected: result.mismatches.map((item) => item.expected ?? "（未声明）").join(" | "),
        actual: result.mismatches.map((item) => item.actual ?? item.reason).join(" | "),
        checks: result.checks,
      },
      evidence: [{ kind: "jsonl", ref: `run:${runId}` }],
      note: `独立回读 ${result.mismatches.length} 项不一致，判不通过`,
    });
    return { verdict: "REJECTED", event, checks: result.checks, mismatches: result.mismatches };
  }
}
