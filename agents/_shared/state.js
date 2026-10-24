// agents/_shared/state.js
// 断点续跑状态 + 原子写。状态外置，进程崩溃后可 --resume 继续。

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, file);
  return file;
}

export async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export function newState({ runId, productDir, outDir, slotIds, engine }) {
  return {
    schemaVersion: "1.0",
    agentId: "ae-product-design",
    runId,
    productDir,
    outDir,
    engine,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "running",
    stages: {},
    slots: Object.fromEntries(
      slotIds.map((id) => [id, { status: "pending", attempts: 0, file: null, qc: null }]),
    ),
    budget: { modelCalls: 0, imageGenerations: 0, startedAt: Date.now() },
    warnings: [],
    redacted: [],
  };
}

export async function saveState(state, file) {
  state.updatedAt = new Date().toISOString();
  await writeJson(file, state);
  return state;
}

export function markStage(state, stage, status, extra = {}) {
  state.stages[stage] = {
    status,
    at: new Date().toISOString(),
    ...extra,
  };
  return state;
}

export function stageDone(state, stage) {
  return state?.stages?.[stage]?.status === "done";
}

export async function loadState(file) {
  const state = await readJson(file);
  return state && state.schemaVersion ? state : null;
}
