import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SelectionService } from "../src/product-selection-service.js";
function fakeStore(initial) {
    let state = initial ?? {
        provider: "chatgpt",
        running: false,
        selection: {
            running: false,
            stage: "IDLE",
            input: null,
            text: "",
            candidates: [],
            updatedAt: null,
            chatUrl: null,
            decided: {},
            error: undefined
        }
    };
    return {
        get: () => state,
        update: (patch) => {
            state = { ...state, ...patch };
            return state;
        }
    };
}
const ALL_PLACEHOLDERS = [
    "RUN_ID", "TASK_TYPE", "RESEARCH_DEPTH", "CANDIDATE_TARGET_COUNT", "MARKET_SCOPE",
    "PLATFORM_SCOPE", "CATEGORY_SCOPE", "TARGET_CUSTOMER_SCOPE", "PRODUCT_INPUTS",
    "TARGET_SELLING_PRICE_RANGE", "MAX_PURCHASE_COST", "TARGET_MARGIN_REQUIREMENT",
    "READY_STOCK_PREFERRED", "CUSTOMIZATION_ALLOWED", "STRUCTURAL_MODIFICATION_ALLOWED",
    "MOLD_OPENING_ALLOWED", "MAX_ACCEPTABLE_MOQ", "TARGET_DEVELOPMENT_LEAD_TIME",
    "OTHER_BUSINESS_CONSTRAINTS", "LOGISTICS_CONSTRAINTS", "AUTHORIZED_CONTEXT_REFS"
];
describe("selection fillPrompt", () => {
    it("substitutes every known placeholder and leaves none behind", () => {
        const svc = new SelectionService(fakeStore(), {});
        const template = ALL_PLACEHOLDERS.map((key) => `${key}=<<<${key}>>>`).join("\n");
        const out = svc.fillPrompt(template, {
            runId: "run-123",
            taskType: "open_opportunity_discovery",
            researchDepth: "deep_research",
            categoryScope: "桌面收纳"
        });
        assert.ok(!/<<<[A-Z_]+>>>/.test(out), `残留占位符：${out}`);
        assert.ok(out.includes("run-123"));
        assert.ok(out.includes("open_opportunity_discovery"));
        assert.ok(out.includes("桌面收纳"));
        /* deep_research 默认候选数量应为 15 */
        assert.ok(out.includes("CANDIDATE_TARGET_COUNT=15"));
    });
    it("derives candidate target count from research depth when not supplied", () => {
        const svc = new SelectionService(fakeStore(), {});
        const quick = svc.fillPrompt("N=<<<CANDIDATE_TARGET_COUNT>>>", { researchDepth: "quick_screening" });
        assert.ok(quick.includes("N=5"));
        const standard = svc.fillPrompt("N=<<<CANDIDATE_TARGET_COUNT>>>", { researchDepth: "standard_research" });
        assert.ok(standard.includes("N=10"));
    });
    it("falls back to u.s. market and default platform when not supplied", () => {
        const svc = new SelectionService(fakeStore(), {});
        const out = svc.fillPrompt("M=<<<MARKET_SCOPE>>>\nP=<<<PLATFORM_SCOPE>>>", { researchDepth: "standard_research" });
        assert.ok(out.includes("M=美国（默认）"));
        assert.ok(out.includes("P=AliExpress"));
    });
});
describe("selection parseSelectionResult", () => {
    function bobResult(candidates) {
        return `<BOB_RESULT_START>${JSON.stringify({ candidates })}<BOB_RESULT_END>`;
    }
    it("extracts candidates and fills a missing candidate_id", () => {
        const svc = new SelectionService(fakeStore(), {});
        const parsed = svc.parseSelectionResult(bobResult([
            { generic_product_name: "A", recommendation: { bob_recommendation_status: "recommend_enter_development_pool" } },
            { candidate_id: "c2", generic_product_name: "B", recommendation: { bob_recommendation_status: "recommend_observe" } }
        ]));
        assert.equal(parsed.candidates.length, 2);
        assert.ok(parsed.candidates[0].candidate_id.startsWith("sel_"));
        assert.equal(parsed.candidates[1].candidate_id, "c2");
        assert.equal(parsed.candidates[0].bob_recommendation_status, "recommend_enter_development_pool");
    });
    it("throws when the result boundary is missing", () => {
        const svc = new SelectionService(fakeStore(), {});
        assert.throws(() => svc.parseSelectionResult("no boundary here"), /缺少/);
    });
    it("throws when candidates array is absent", () => {
        const svc = new SelectionService(fakeStore(), {});
        assert.throws(() => svc.parseSelectionResult(bobResult({ notCandidates: true })), /candidates/);
    });
});
describe("selection runSelection guards", () => {
    it("rejects a second run while selection is already running", async () => {
        const store = fakeStore();
        store.get().selection.running = true;
        const svc = new SelectionService(store, {});
        await assert.rejects(() => svc.runSelection({ taskType: "x", categoryScope: "y" }), /正在运行/);
    });
    it("rejects when a global flow holds the AI session", async () => {
        const store = fakeStore();
        store.get().running = true;
        const svc = new SelectionService(store, {});
        await assert.rejects(() => svc.runSelection({ taskType: "x", categoryScope: "y" }), /AI 会话/);
    });
});
describe("selection recoverFromDisk", () => {
    it("returns false when there is no disk file and no in-state candidates", async () => {
        const svc = new SelectionService(fakeStore(), {});
        assert.equal(await svc.recoverFromDisk(), false);
    });
});
describe("selection providerName", () => {
    it("maps provider ids to display names", () => {
        const svc = new SelectionService(fakeStore(), {});
        assert.equal(svc.providerName("chatgpt"), "ChatGPT");
        assert.equal(svc.providerName("gemini"), "Gemini");
    });
});
