import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runAgent } from "../../agents/ae-product-design/src/runner.js";
import { ModelClient } from "../../agents/ae-product-design/src/model.js";
import { AgentError, CODES } from "../../agents/_shared/errors.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6QAAAABJRU5ErkJggg==", "base64");
async function fixture(t, ids, failId) {
  const base = path.resolve(tmpdir());
  const productDir = await mkdtemp(path.join(base, "runner-safe-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(productDir)), base);
    assert.ok(path.basename(productDir).startsWith("runner-safe-"));
    await rm(productDir, { recursive: true, force: true });
  });
  await mkdir(path.join(productDir, "产品图"));
  await writeFile(path.join(productDir, "产品图", "one.png"), png);
  const config = JSON.parse(await readFile("agents/ae-product-design/config/image-slots.json", "utf8"));
  config.slots = config.slots.filter(s => ids.includes(s.id)).map(s => ({ ...s, scoring: false, productScale: undefined }));
  for (const spec of Object.values(config.spec)) Object.assign(spec, { minWidth: 1, minHeight: 1, minBytes: 1, aspect: "1:1" });
  const slotsFile = path.join(productDir, "slots.json");
  await writeFile(slotsFile, JSON.stringify(config));
  let generated = 0;
  const old = {};
  for (const name of ["openPlanningChat", "askJson", "generateImage", "healthCheck"]) old[name] = ModelClient.prototype[name];
  t.after(() => Object.assign(ModelClient.prototype, old));
  for (const name of ["openPlanningChat", "askJson", "healthCheck"]) {
    ModelClient.prototype[name] = async () => { throw new Error(`Unexpected external method ${name}`); };
  }
  ModelClient.prototype.generateImage = async ({ slotId, outputPath }) => {
    if (slotId === failId) throw new AgentError(CODES.IMAGE_TOOL_UNAVAILABLE, "controlled test interruption");
    generated++;
    await writeFile(outputPath, png);
  };
  const opts = { productDir, slotsFile, noVisionIdentify: true, autoApprove: true, visionQc: false };
  await runAgent({ ...opts, dryRun: true });
  return { productDir, opts, generated: () => generated, state: async () => JSON.parse(await readFile(path.join(productDir, "design/run-state.json"), "utf8")) };
}

test("未验证候选续跑只补验，不重复生图", async t => {
  const f = await fixture(t, ["P2"]);
  await runAgent({ ...f.opts, resume: true });
  const resumed = await runAgent({ ...f.opts, resume: true });
  assert.equal(f.generated(), 1);
  const candidate = (await f.state()).slots.P2;
  assert.equal(candidate.status, "unverified");
  assert.equal(candidate.file, null);
  assert.ok(candidate.candidateFile);
  await access(candidate.candidateFile);
  assert.equal(resumed.report.slots.find(s => s.id === "P2").file, null);
  assert.equal(resumed.report.counts.delivered, 0);
});

test("后续槽位异常也不让未验证图片留在交付目录", async t => {
  const f = await fixture(t, ["P2", "P3"], "P3");
  const stopped = await runAgent({ ...f.opts, resume: true });
  const candidate = (await f.state()).slots.P2;
  assert.equal(stopped.status, "escalated");
  assert.equal(stopped.report.slots.find(s => s.id === "P2").file, null);
  assert.equal(candidate.file, null);
  assert.ok(candidate.candidateFile);
  await access(candidate.candidateFile);
  await assert.rejects(access(path.join(f.productDir, "design/images/P2.jpg")), { code: "ENOENT" });
});

test("候选补验通过后恢复交付文件且不重新生图", async t => {
  const f = await fixture(t, ["P2"]);
  await runAgent({ ...f.opts, resume: true });
  ModelClient.prototype.openPlanningChat = async () => {};
  ModelClient.prototype.askJson = async ({ validate }) => {
    const result = { slotId: "P2", sku: { pass: true, detected: "same product" }, shotType: { match: true },
      productFidelity: { pass: true }, background: { pass: true }, text: { policyOk: true },
      composition: { pass: true }, verdict: "pass" };
    validate(result);
    return result;
  };
  const resumed = await runAgent({ ...f.opts, resume: true, visionQc: true });
  assert.equal(f.generated(), 1);
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.report.counts.delivered, 1);
  const slot = (await f.state()).slots.P2;
  assert.equal(slot.candidateFile, null);
  assert.equal(slot.status, "passed");
  await access(slot.file);
});

test("恢复状态不能把输出目录之外的文件交给模型", async t => {
  const f = await fixture(t, ["P2"]);
  const outside = `${f.productDir}-outside.png`;
  await writeFile(outside, png);
  t.after(() => unlink(outside));
  const state = await f.state();
  state.slots.P2 = { status: "unverified", candidateFile: outside, file: null, attempts: 0 };
  await writeFile(path.join(f.productDir, "design/run-state.json"), JSON.stringify(state));
  let opened = 0;
  ModelClient.prototype.openPlanningChat = async () => { opened++; throw new Error("unauthorized candidate reached model"); };
  await assert.rejects(runAgent({ ...f.opts, resume: true, visionQc: true }));
  assert.equal(opened, 0);
  assert.equal(f.generated(), 0);
  assert.deepEqual(await readFile(outside), png);
});
