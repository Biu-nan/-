// agents/purchase-inventory/src/audit.js
// inventory.audit —— P0 纯读聚合能力（CAPABILITY_REGISTRY_DRAFT 能力 #14）。
//
// 声明（见 contract.md §4）：
//   sideEffect = P0，gate.required = false，无副作用，无需回滚。
//   但**必须有 verify**：回读原始口径值并逐个比哈希，不一致即 REJECTED。
//
// 数据来源通过 reader 注入，本模块不自己抓平台。
// 这样做的原因：真实采集链属 C2（等稳卖路径），现在假装能抓就成了编数据。
// 当前提供 fromSnapshot() 读"采集管线落盘的快照"，接线后即可对接真实采集。

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AgentError, CODES } from "../../../dist/src/agent-shared/errors.js";
import { REQUIRED_CALIBERS, REJECT, beijingHour, DEFAULTS } from "./decide.js";

export const CAPABILITY = Object.freeze({
  id: "inventory.audit",
  version: "1.0",
  name: "库存真实可用核对",
  endpoint: "local.only",
  sideEffect: "P0",
  gate: Object.freeze({ required: false }),
  produces: Object.freeze({ unitKind: "INVENTORY_AUDIT", artifacts: Object.freeze(["inventory-audit.json"]) }),
});

const canon = (v) =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
      : v;

export function sha256Of(value) {
  return createHash("sha256").update(JSON.stringify(canon(value))).digest("hex");
}

/** 从采集快照构造 reader。快照形如 { storeId, asOf, collectedAt, calibers:{...} }。 */
export function fromSnapshot(snapshot) {
  return async function readCalibers() {
    if (!snapshot || typeof snapshot !== "object") {
      throw new AgentError(CODES.INPUT_INVALID, "快照不是对象");
    }
    return {
      calibers: { ...(snapshot.calibers ?? {}) },
      collectedAt: snapshot.collectedAt ?? snapshot.asOf ?? null,
    };
  };
}

/** 从磁盘读快照文件。 */
export function fromSnapshotFile(file) {
  return async function readCalibers() {
    const raw = await readFile(file, "utf8");
    return fromSnapshot(JSON.parse(raw))();
  };
}

/** 校验并归一化一次读取结果；缺必需口径即 fail-closed。 */
function assertComplete(calibers) {
  const missing = REQUIRED_CALIBERS.filter(
    (k) => !Number.isFinite(calibers?.[k]) || calibers[k] < 0,
  );
  if (missing.length > 0) {
    throw new AgentError(REJECT.CALIBER_MISSING, `必需口径缺失或非法：${missing.join(", ")}`, {
      missing,
      required: [...REQUIRED_CALIBERS],
    });
  }
}

/**
 * 执行一次库存核对。
 * @param {object} opts
 * @param {Function} opts.readCalibers  注入的读取函数（返回 {calibers, collectedAt}）
 * @param {string} opts.storeId
 * @param {string} opts.asOf            ISO 时间，数据截止时刻
 * @param {string[]} [opts.skuIds]
 */
export async function audit({ readCalibers, storeId, asOf, skuIds = [] } = {}) {
  if (typeof readCalibers !== "function") {
    throw new AgentError(CODES.INPUT_INVALID, "readCalibers 必须是函数（reader 注入，不复用执行方路径）");
  }
  if (!storeId) throw new AgentError(CODES.INPUT_INVALID, "storeId 必填");

  const hour = beijingHour(asOf);
  if ((DEFAULTS.rejectHours).includes(hour)) {
    throw new AgentError(
      REJECT.DAY_CUT_WINDOW,
      `asOf 落在北京时间 ${hour} 点日切窗口，平台数据归零，拒绝读取`,
      { asOf, beijingHour: hour },
    );
  }

  const { calibers, collectedAt } = await readCalibers({ storeId, asOf, skuIds });
  assertComplete(calibers);

  const physicalAvailable =
    calibers["inventory.actual"] - calibers["inventory.occupied"] + calibers["inventory.transit"];

  const record = Object.freeze({
    schema: "purchase-inventory/audit/v1",
    capabilityId: CAPABILITY.id,
    sideEffect: CAPABILITY.sideEffect,
    storeId,
    asOf,
    collectedAt,
    skuIds: [...skuIds],
    calibers: Object.freeze({ ...calibers }),
    derived: Object.freeze({ physicalAvailable }),
  });

  return Object.freeze({ record, hash: sha256Of(record) });
}

/**
 * 回读校验：重新读一次，与已记录的哈希比对。
 * 任何不一致整批 REJECTED，不partial pass。
 */
export async function verifyAudit({ record, hash, readCalibers } = {}) {
  if (!record || !hash) {
    throw new AgentError(CODES.INPUT_INVALID, "verify 需要 record 与 hash");
  }
  const again = await readCalibers({
    storeId: record.storeId,
    asOf: record.asOf,
    skuIds: record.skuIds,
  });
  assertComplete(again.calibers);

  const physicalAgain =
    again.calibers["inventory.actual"] -
    again.calibers["inventory.occupied"] +
    again.calibers["inventory.transit"];

  const rehash = sha256Of({
    ...record,
    calibers: again.calibers,
    derived: { physicalAvailable: physicalAgain },
  });

  const mismatches = [];
  for (const k of REQUIRED_CALIBERS) {
    if (record.calibers[k] !== again.calibers[k]) {
      mismatches.push({ caliber: k, recorded: record.calibers[k], readback: again.calibers[k] });
    }
  }

  return {
    verdict: mismatches.length === 0 && rehash === hash ? "VERIFIED" : "REJECTED",
    checks: {
      hashMatch: rehash === hash,
      calibrationMatch: mismatches.length === 0,
      physicalAvailableMatch: physicalAgain === record.derived.physicalAvailable,
    },
    mismatches,
    recordedHash: hash,
    readbackHash: rehash,
  };
}
