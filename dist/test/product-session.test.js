import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractChineseProductName, sanitizeProductName } from "../src/product-session.js";
function state(patch) {
    return {
        stage: "COMPLETED",
        message: "done",
        running: false,
        workflowMode: "standard_listing",
        standardWorkflowGoal: "full_listing",
        browserStarted: false,
        provider: "chatgpt",
        imageCount: 0,
        imageNames: [],
        updatedAt: new Date(0).toISOString(),
        ...patch
    };
}
describe("product archive naming", () => {
    it("prefers the explicit Chinese product name from MVP1", () => {
        assert.equal(extractChineseProductName(state({
            responseText: "Recommended Chinese Product Name: 水果造型零钱包钥匙扣\nRecommended Product Name: Fruit Keychain"
        })), "水果造型零钱包钥匙扣");
    });
    it("falls back to the Chinese product phrase in research", () => {
        assert.equal(extractChineseProductName(state({
            researchText: "基于已上传产品（迷你双拉链背包零钱包钥匙扣）完成市场调研。"
        })), "迷你双拉链背包零钱包钥匙扣");
    });
    it("removes characters that cannot be used safely in folder names", () => {
        assert.equal(sanitizeProductName("水果/零钱包：钥匙扣?"), "水果 零钱包 钥匙扣");
    });
});
//# sourceMappingURL=product-session.test.js.map