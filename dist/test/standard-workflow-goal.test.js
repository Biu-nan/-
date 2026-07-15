import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSeoContentReady, standardAutoStep } from "../src/automation-service.js";
function state(patch = {}) {
    return {
        stage: "IDLE",
        message: "test",
        running: false,
        workflowMode: "standard_listing",
        standardWorkflowGoal: "full_listing",
        researchCompleted: false,
        browserStarted: false,
        provider: "chatgpt",
        imageCount: 1,
        imageNames: ["product.jpg"],
        updatedAt: new Date(0).toISOString(),
        ...patch
    };
}
describe("standard workflow goal routing", () => {
    it("keeps the legacy full listing route as the default", () => {
        assert.equal(standardAutoStep(state({ completedPhase: "MVP1" })), "planning");
    });
    it("routes SEO-only tasks from identification to research and then SEO", () => {
        const identified = state({
            standardWorkflowGoal: "seo_content_only",
            completedPhase: "MVP1"
        });
        assert.equal(standardAutoStep(identified), "research");
        assert.equal(standardAutoStep({ ...identified, researchCompleted: true }), "seo");
    });
    it("allows SEO-only content without generated images", () => {
        assert.equal(isSeoContentReady(state({
            standardWorkflowGoal: "seo_content_only",
            completedPhase: "MVP1",
            researchCompleted: true,
            generatedImageNumbers: []
        })), true);
    });
    it("still requires all ten images for the full listing route", () => {
        assert.equal(isSeoContentReady(state({
            completedPhase: "MVP4",
            generatedImageNumbers: [1, 2, 3]
        })), false);
        assert.equal(isSeoContentReady(state({
            completedPhase: "MVP4",
            generatedImageNumbers: Array.from({ length: 10 }, (_, index) => index + 1)
        })), true);
    });
});
//# sourceMappingURL=standard-workflow-goal.test.js.map