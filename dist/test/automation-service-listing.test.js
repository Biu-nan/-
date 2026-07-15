import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AutomationService } from "../src/automation-service.js";
function promptPack() {
    return Array.from({ length: 10 }, (_, index) => {
        const number = String(index + 1).padStart(2, "0");
        const finalPrompt = index === 0
            ? "Create a collage grid that references Image 02."
            : `Create Image ${number} only with a distinct product composition.`;
        return [
            `<<<IMAGE_${number}_PROMPT_START>>>`,
            `## Image ${number} Ready-to-Generate Prompt`,
            `- Funnel Stage: proof`,
            `- Buyer Question: Buyer question ${number}`,
            `- Core Selling Point: Core selling point ${number}`,
            `- Visual Proof: Visual proof ${number}`,
            `- English Copy on Image: Headline ${number}`,
            `- Final Image Generation Prompt: ${finalPrompt}`,
            `<<<IMAGE_${number}_PROMPT_END>>>`
        ].join("\n");
    }).join("\n\n");
}
function state(patch = {}) {
    return {
        stage: "IDLE",
        message: "test",
        running: false,
        workflowMode: "standard_listing",
        standardWorkflowGoal: "full_listing",
        researchCompleted: true,
        browserStarted: false,
        provider: "chatgpt",
        imageCount: 1,
        imageNames: ["product.jpg"],
        updatedAt: new Date(0).toISOString(),
        ...patch
    };
}
class FakeStore {
    current;
    constructor(initial) {
        this.current = initial;
    }
    get() {
        return structuredClone(this.current);
    }
    async update(patch) {
        this.current = {
            ...this.current,
            ...patch,
            updatedAt: new Date().toISOString()
        };
        return this.get();
    }
}
class FakeAiAdapter {
    prompts = [];
    uploadedPaths = [];
    events = [];
    completedResponses = new Map();
    userPrompts = new Set();
    waitResponses = new Map();
    async launch() {
        throw new Error("not used");
    }
    async checkReady() {
        return { ready: true, status: "ready", url: "about:blank" };
    }
    async createBlankChat() {
        return "chat://new";
    }
    async openChat(chatUrl) {
        return chatUrl;
    }
    async uploadImages(paths) {
        this.uploadedPaths.push(paths);
        this.events.push("upload-images");
    }
    async enableWebSearch() { }
    async enableImageCreation() { }
    async waitForGeneratedImageAndDownload(_previousGeneratedImageCount, _outputPath) { }
    async recoverCompletedGeneratedImages() {
        return [];
    }
    async generatedImageCount() {
        return 0;
    }
    async saveLatestCompletedGeneratedImage() {
        return false;
    }
    async sendPromptOnce(prompt, fingerprint) {
        this.prompts.push(prompt);
        this.userPrompts.add(fingerprint);
        this.events.push("send-prompt");
        return this.prompts.length;
    }
    async recoverCompletedResponse(fingerprint) {
        return this.completedResponses.get(fingerprint);
    }
    async hasUserPrompt(fingerprint) {
        return this.userPrompts.has(fingerprint);
    }
    async waitForResponseAfterPrompt(fingerprint) {
        return this.waitResponses.get(fingerprint) ?? "";
    }
    currentUrl() {
        return "chat://current";
    }
}
describe("standard listing image generation", () => {
    it("does not hard-stop image generation on storyboard or prompt-pack QC failures", async () => {
        const store = new FakeStore(state({
            completedPhase: "MVP3",
            promptPackValid: true,
            planningText: promptPack(),
            chatUrl: "chat://existing",
            generatedImageNumbers: [2, 3, 4, 5, 6, 7, 8, 9, 10],
            outputFiles: Array.from({ length: 9 }, (_, index) => `Image_${String(index + 2).padStart(2, "0")}.png`)
        }));
        const ai = new FakeAiAdapter();
        const visualAssets = {
            currentProductId: async () => "product-1",
            validateGenerationInput: async () => ({
                product_id: "product-1",
                image_number: "01",
                prompt_version: "single-image-v1",
                reference_image_asset_ids: [],
                reference_image_hashes: [],
                active_reference_set_id: "reference-1",
                identity_lock_version: "identity-1",
                warnings: [],
                reference_image_paths: [
                    "/tmp/current-product-front.jpg",
                    "/tmp/current-product-side.png"
                ]
            }),
            logGeneration: async () => undefined
        };
        const service = new AutomationService(store, { chatgpt: ai, gemini: ai }, visualAssets);
        await service.generateImages();
        assert.equal(ai.prompts.length, 1);
        assert.deepEqual(ai.uploadedPaths, [[
                "/tmp/current-product-front.jpg",
                "/tmp/current-product-side.png"
            ]]);
        assert.deepEqual(ai.events, ["upload-images", "send-prompt"]);
        assert.deepEqual(store.current.generatedImageNumbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        assert.equal(store.current.completedPhase, "MVP4");
        assert.ok(store.current.outputFiles?.includes("Image_01.png"));
    });
});
describe("standard listing SEO and content handoff", () => {
    it("sends listing content with a stable backend fingerprint", async () => {
        const store = new FakeStore(state({
            completedPhase: "MVP4",
            chatUrl: "chat://existing",
            seoKeywordText: "seo keywords",
            generatedImageNumbers: Array.from({ length: 10 }, (_, index) => index + 1)
        }));
        const ai = new FakeAiAdapter();
        ai.waitResponses.set("AliExpress Listing Commercial Delivery Prompt", "listing content");
        const service = new AutomationService(store, {
            chatgpt: ai,
            gemini: ai
        });
        await service.generateSeoListingContent();
        assert.ok(ai.prompts.some((prompt) => prompt.includes("AliExpress Listing Commercial Delivery Prompt")));
        assert.equal(store.current.completedPhase, "MVP5");
        assert.equal(store.current.listingContentText, "listing content");
    });
    it("recovers listing content from previously sent Chinese listing prompts", async () => {
        const store = new FakeStore(state({
            completedPhase: "MVP4",
            chatUrl: "chat://existing",
            seoKeywordText: "seo keywords",
            generatedImageNumbers: Array.from({ length: 10 }, (_, index) => index + 1)
        }));
        const ai = new FakeAiAdapter();
        ai.completedResponses.set("AliExpress 通用 Listing 标题 属性词 轻详情页生成 Prompt", "recovered listing content");
        const service = new AutomationService(store, {
            chatgpt: ai,
            gemini: ai
        });
        await service.generateSeoListingContent();
        assert.equal(ai.prompts.length, 0);
        assert.equal(store.current.completedPhase, "MVP5");
        assert.equal(store.current.listingContentText, "recovered listing content");
    });
});
//# sourceMappingURL=automation-service-listing.test.js.map