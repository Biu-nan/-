import assert from "node:assert/strict";
import { test } from "node:test";
import { ListingAgent } from "../src/listing-agent.js";
import { FakeAIProvider } from "../src/ai/ai-provider.js";

async function fixture() {
  const agent = new ListingAgent({ ai: new FakeAIProvider() });
  const baseline = await agent.run({
    profileKey: "ruTie", input: { type: "images", images: ["/fixtures/product.png"] },
  });
  const submitted = [];
  return {
    facts: baseline.facts,
    submitted,
    agent: new ListingAgent({
      ai: new FakeAIProvider(),
      publisher: { async publish(facts) { submitted.push(structuredClone(facts)); return { status: "test_saved" }; } },
    }),
  };
}

test("schema硬错误且没有业务缺项时仍阻止提交", async () => {
  const f = await fixture();
  const result = await f.agent.run({
    profileKey: "ruTie",
    input: { type: "factsJson", factsJson: f.facts, overrides: { weight: "invalid-weight" } },
    options: { generateContent: false, publish: true },
  });
  assert.equal(result.validation.schemaValid, false);
  assert.equal(f.submitted.length, 0, "不应把硬错误降级为可提交警告");
  assert.equal(result.status, "needs_human");
  assert.ok(result.validation.blockers.some(b => b.code === "SCHEMA_INVALID"));
});

for (const generateContent of [false, true]) {
  test(`来源待复核经过${generateContent ? "AI生成" : "事实归一化"}后不能提交`, async () => {
    const f = await fixture();
    f.facts.meta = { provenance: { source: "ecom-translator", reviewRequired: true, gaps: ["weight evidence missing"] } };
    const result = await f.agent.run({
      profileKey: "ruTie",
      input: { type: generateContent ? "hybrid" : "factsJson", factsJson: f.facts, images: ["/fixtures/product.png"] },
      options: { generateContent, publish: true },
    });
    assert.equal(f.submitted.length, 0);
    assert.equal(result.facts.meta.provenance.reviewRequired, true);
    assert.deepEqual(result.facts.meta.provenance.gaps, ["weight evidence missing"]);
    assert.equal(result.status, "needs_human");
    assert.ok(result.validation.blockers.some(b => b.code === "SOURCE_REVIEW_REQUIRED"));
  });
}

test("零次修复不自动填充缺项，也不提交未完成草稿", async () => {
  const f = await fixture();
  f.facts.keyAttributes = [];
  const result = await f.agent.run({
    profileKey: "ruTie", input: { type: "factsJson", factsJson: f.facts },
    options: { generateContent: false, maxAutoFixRounds: 0, publish: true },
  });
  assert.equal(result.autoFixLog.length, 0);
  assert.equal(result.validation.completeness.ok, false);
  assert.equal(f.submitted.length, 0);
  assert.equal(result.status, "needs_human");
});

for (const maxAutoFixRounds of [-1, 1.5, Infinity, "3", 4]) {
  test(`非法修复上限${String(maxAutoFixRounds)}在执行前被拒绝`, async () => {
    const f = await fixture();
    await assert.rejects(f.agent.run({
      input: { type: "factsJson", factsJson: f.facts },
      options: { maxAutoFixRounds, publish: true },
    }), /maxAutoFixRounds/);
    assert.equal(f.submitted.length, 0);
  });
}

test("完整合法且无来源阻断的草稿仍可提交一次", async () => {
  const f = await fixture();
  const result = await f.agent.run({
    profileKey: "ruTie", input: { type: "factsJson", factsJson: f.facts },
    options: { generateContent: false, publish: true },
  });
  assert.equal(result.status, "success");
  assert.equal(result.validation.schemaValid, true);
  assert.equal(result.validation.completeness.ok, true);
  assert.equal(f.submitted.length, 1);
  assert.equal(result.publish.status, "test_saved");
});
