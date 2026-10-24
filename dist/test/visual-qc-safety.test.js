import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as qc from "../../agents/ae-product-design/src/qc.js";

const slot = { id: "P1", module: "product", scoring: true, shot: "full" };
const scoringConfig = { threshold: 80, dimensions: [{ key: "fidelity", label: "保真", weight: 60, minRatio: 0.6 }, { key: "clarity", label: "清晰", weight: 40, minRatio: 0.6 }] };
const dimension = { pass: true, problems: [], width: 1000, height: 1000 };
function result(scores = [60, 40]) {
  return { slotId: "P1", sku: { pass: true, detected: "orange" }, shotType: { match: true },
    productFidelity: { pass: true }, background: { pass: true }, text: { policyOk: true }, composition: { pass: true },
    heroScore: { total: scores[0] + scores[1], dimensions: [{ key: "fidelity", score: scores[0] }, { key: "clarity", score: scores[1] }] }, verdict: "pass" };
}
function compose(overrides = {}) {
  return qc.composeQcResult({ slot, dimension, result: result(), scoringConfig, thumbnail: { file: "P1_160.jpg", size: 160 }, ...overrides });
}

test("首图总分不足不能作为交付通过", () => {
  const actual = compose({ result: result([0, 0]) });
  assert.equal(actual.verdict, "fail");
  assert.equal(actual.heroJudge.pass, false);
  assert.match(actual.reason, /总分/);
  assert.equal(qc.isQcDeliverable(actual, slot), false);
});
test("总分达标但单项不达标仍然拒收", () => {
  const actual = compose({ result: result([60, 20]) });
  assert.equal(actual.verdict, "fail");
  assert.equal(qc.isQcDeliverable(actual, slot), false);
});
test("首图未提供缩略图不能宣称完成可读性检查", () => {
  const actual = compose({ thumbnail: null });
  assert.equal(actual.verdict, "unverified");
  assert.equal(qc.isQcDeliverable(actual, slot), false);
});
test("尺寸失败优先拒收即使视觉与首图评分通过", () => {
  const actual = compose({ dimension: { pass: false, problems: ["宽度不足"] } });
  assert.equal(actual.verdict, "fail");
  assert.match(actual.reason, /宽度不足/);
});
test("完整通过保留评分和确定性尺寸结果", () => {
  const actual = compose();
  assert.equal(actual.verdict, "pass");
  assert.equal(actual.heroJudge.pass, true);
  assert.equal(actual.dimension.width, 1000);
  assert.equal(qc.isQcDeliverable(actual, slot), true);
});
test("非首图不要求首图评分和缩略图", () => {
  const standard = { ...slot, id: "P2", scoring: false };
  const vision = { ...result(), slotId: "P2" }; delete vision.heroScore;
  const actual = compose({ slot: standard, result: vision, thumbnail: null });
  assert.equal(qc.isQcDeliverable(actual, standard), true);
});
test("本地只检查三项时保留其他维度未验证", () => {
  const actual = qc.buildLocalQc({ slot, dimension, audit: { available: true, isTargetSku: true, sku: "orange", shotMatch: true, shotType: "full", hasText: false } });
  assert.equal(actual.verdict, "unverified");
  assert.equal(actual.dimension.width, 1000);
  assert.notEqual(actual.productFidelity.pass, true);
  assert.notEqual(actual.background.pass, true);
  assert.notEqual(actual.composition.pass, true);
  assert.equal(qc.isQcDeliverable(actual, slot), false);
});
test("本地兜底仍然保留尺寸失败和SKU失败", () => {
  const actual = qc.buildLocalQc({ slot, dimension: { pass: false, problems: ["wrong ratio"] }, audit: { available: true, isTargetSku: false, shotMatch: true, hasText: false } });
  assert.equal(actual.verdict, "fail");
  assert.equal(actual.dimension.pass, false);
  assert.equal(actual.sku.pass, false);
});
test("旧缓存自称pass但首图评分失败不能复用", () => {
  assert.equal(qc.isQcDeliverable({ ...result(), dimension, heroJudge: { pass: false } }, slot), false);
});
test("旧缓存本地三项兜底pass不能复用", () => {
  assert.equal(qc.isQcDeliverable({ ...result(), dimension, heroJudge: { pass: true }, source: "local-vl", coverage: ["sku", "shotType", "text"] }, slot), false);
});
test("视觉对象的失败标记不能被总体pass掩盖", () => {
  assert.equal(qc.isQcDeliverable({ ...result(), dimension, heroJudge: { pass: true }, productFidelity: { pass: false } }, slot), false);
});

test("实际runQc保留文件尺寸并消费独立视觉结果", async t => {
  const base = path.resolve(tmpdir());
  const dir = await mkdtemp(path.join(base, "qc-safe-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(dir)), base);
    assert.ok(path.basename(dir).startsWith("qc-safe-"));
    await rm(dir, { recursive: true, force: true });
  });
  const imageFile = path.join(dir, "one.png");
  await writeFile(imageFile, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6QAAAABJRU5ErkJggg==", "base64"));
  const standard = { ...slot, id: "P2", scoring: false };
  const vision = { ...result(), slotId: "P2" }; delete vision.heroScore;
  const model = {
    async openPlanningChat(paths) { assert.deepEqual(paths, [imageFile, imageFile]); },
    async askJson({ validate }) { validate(vision); return vision; },
  };
  const actual = await qc.runQc({ model, slot: standard, spec: { aspect: "1:1", minWidth: 1, minHeight: 1 }, imageFile, referenceImage: imageFile });
  assert.equal(actual.dimension.width, 1);
  assert.equal(actual.dimension.height, 1);
  assert.equal(qc.isQcDeliverable(actual, standard), true);
});
