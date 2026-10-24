// Listing Agent 流水线测试：用 FakeAIProvider（内存桩）验证 Parse/Generate/Validate/自纠错。
// 不依赖真实 Chrome / 店小秘 / ChatGPT。运行：node --test listing-agent/test/
import { test } from "node:test";
import assert from "node:assert/strict";

import { ListingAgent } from "../src/listing-agent.js";
import { FakeAIProvider } from "../src/ai/ai-provider.js";

function makeAgent() {
  return new ListingAgent({ ai: new FakeAIProvider(), publisher: null });
}

test("happy path：images 输入 → AI 生成 → 校验通过 → success", async () => {
  const agent = makeAgent();
  const res = await agent.run({
    profileKey: "ruTie",
    input: { type: "images", images: ["/tmp/Image_01.png", "/tmp/Image_02.png"] },
    options: { generateContent: true, mode: "listing-only" },
  });
  assert.equal(res.status, "success");
  assert.equal(res.profileKey, "ruTie");
  assert.ok(res.facts.title.en, "应有英文标题");
  assert.ok(res.facts.description.pc, "应有 PC 详情");
  assert.deepEqual(res.facts.images.main, ["Image_01.png", "Image_02.png"], "应注入主图文件名");
  // 5 个类目必填属性应由 FakeAI 产出
  const labels = res.facts.keyAttributes.map((a) => a.name);
  assert.ok(labels.includes("高关注化学品"));
  assert.equal(res.validation.completeness.ok, true);
  assert.equal(res.validation.schemaValid, true);
});

test("auto-fix：缺 requiredAttrs → 用 profile 默认值自纠错 → success", async () => {
  const agent = makeAgent();
  const res = await agent.run({
    profileKey: "ruTie",
    input: {
      type: "factsJson",
      factsJson: {
        title: { zh: "测试乳贴", en: "Test Nipple Covers" },
        description: { pc: "详情", mobile: "详情" },
        category: "内衣配件（乳贴/乳垫/肩带等）(Women's Intimates Accessories)",
        unit: "件(piece)",
        hsCode: "3",
        images: { main: ["x.png"] },
        variants: { dimensions: ["尺码"], skus: [] },
        keyAttributes: [], // 故意缺失 5 个 requiredAttrs
      },
    },
    options: { generateContent: false }, // 不走 AI，纯校验+自纠错
  });
  assert.equal(res.status, "success");
  assert.ok(res.autoFixLog.length >= 5, "应至少填 5 个默认值，实际: " + JSON.stringify(res.autoFixLog));
  assert.ok(res.facts.keyAttributes.length >= 5);
});

test("needs_human：缺主图（不可自纠错项）→ needs_human 且明确缺项", async () => {
  const agent = makeAgent();
  const res = await agent.run({
    profileKey: "ruTie",
    input: {
      type: "factsJson",
      factsJson: {
        title: { zh: "测试乳贴", en: "Test Nipple Covers" },
        description: { pc: "详情", mobile: "详情" },
        category: "内衣配件（乳贴/乳垫/肩带等）(Women's Intimates Accessories)",
        unit: "件(piece)",
        hsCode: "3",
        images: { main: [] }, // 无主图 → 不可解
        variants: { dimensions: ["尺码"], skus: [] },
        keyAttributes: [
          { name: "高关注化学品", value: "天然未处理(None)" },
          { name: "产地（国家或地区）", value: "中国大陆(Origin)(Mainland China)" },
          { name: "是否性暗示", value: "否(No)" },
          { name: "颜色风格", value: "自然色(Natural Color)" },
          { name: "是否暴露图片", value: "否(No)" },
        ],
      },
    },
    options: { generateContent: false },
  });
  assert.equal(res.status, "needs_human");
  assert.ok(res.validation.completeness.missing.includes("主图(images.main)"));
});

test("validate()：仅校验/归一化，返回 report 与 missing", async () => {
  const agent = makeAgent();
  const r = await agent.validate({
    profileKey: "ruTie",
    input: { type: "factsJson", factsJson: { title: { en: "X" }, images: { main: ["a.png"] } } },
    options: { generateContent: false },
  });
  assert.equal(r.profileKey, "ruTie");
  assert.ok(r.report, "应有 report");
  assert.ok(Array.isArray(r.missing));
});
