import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractNumberedImagePrompt, extractImagePrompt, readPrompt, validateSingleImagePromptV2, validateNumberedPromptPack, validatePromptPack } from "../src/prompt-files.js";
function completePromptPack() {
    return Array.from({ length: 10 }, (_, index) => {
        const number = String(index + 1).padStart(2, "0");
        return [
            `<<<IMAGE_${number}_PROMPT_START>>>`,
            `Image ${index + 1}`,
            `<<<IMAGE_${number}_PROMPT_END>>>`
        ].join("\n");
    }).join("\n\n");
}
describe("prompt pack validation", () => {
    it("accepts all ten prompt start and end markers", () => {
        assert.deepEqual(validatePromptPack(completePromptPack()), {
            valid: true,
            missing: []
        });
    });
    it("reports a missing marker", () => {
        const text = completePromptPack().replace("<<<IMAGE_07_PROMPT_END>>>", "");
        const result = validatePromptPack(text);
        assert.equal(result.valid, false);
        assert.deepEqual(result.missing, ["<<<IMAGE_07_PROMPT_END>>>"]);
    });
    it("extracts exactly one numbered image prompt", () => {
        assert.equal(extractImagePrompt(completePromptPack(), 4), "Image 4");
    });
    it("supports the seven-image luxury insert prompt pack", () => {
        const text = completePromptPack()
            .split("<<<IMAGE_08_PROMPT_START>>>")[0]
            .trim();
        assert.deepEqual(validateNumberedPromptPack(text, 7), {
            valid: true,
            missing: []
        });
        assert.equal(extractNumberedImagePrompt(text, 7, 7), "Image 7");
    });
    it("keeps the strict luxury insert layouts and fixed copy in the template", async () => {
        const prompt = await readPrompt("luxuryInsert");
        for (const reference of [
            "S18d76835c5a54d0cb0c48b6e330e18677.jpg",
            "S236c7a0180304ebf840f6c9b662fcaa1G.jpg",
            "S3b5200c53dd74b38bd61f048bb260bb2Q.jpg",
            "S71c26ee125544754a4842a589941d6520.jpg",
            "Se35c64f867b74947a972b316f5a0e8b9h.jpg"
        ]) {
            assert.match(prompt, new RegExp(reference.replace(".", "\\.")));
        }
        assert.match(prompt, /1:1 PERFECT BAG COMPATIBILITY/);
        assert.match(prompt, /MORE PRODUCT DETAILS/);
        assert.match(prompt, /MULTIPLE COMPARTMENTS LARGE CAPACITY/);
        assert.match(prompt, /no pedestal, no podium, no platform/);
    });
    it("keeps the insert market radar prompt tied to development pool, native organization audit and official front images", async () => {
        const prompt = await readPrompt("insertMarketRadar");
        assert.match(prompt, /全网热销包型机会雷达 Agent v0\.3/);
        assert.match(prompt, /Native Organization Audit/);
        assert.match(prompt, /Pain Gap/);
        assert.match(prompt, /Insert Value Type/);
        assert.match(prompt, /<<<MARKET_RADAR_DATA_START>>>/);
        assert.match(prompt, /<<<MARKET_RADAR_DATA_END>>>/);
        assert.match(prompt, /Official \/ Trusted White Front Image URL/);
        assert.match(prompt, /Not found \/ needs manual sourcing/);
        assert.match(prompt, /包型开发池 → 尺寸匹配系统/);
    });
    it("exposes Listing visual workflow v2 prompt templates through the prompt registry", async () => {
        const marketAudit = await readPrompt("marketVisualAuditV2");
        assert.match(marketAudit, /Final Visual Decision for Next-Step Planning/);
        assert.match(marketAudit, /Product similarity: 40%/);
        assert.match(marketAudit, /mobile thumbnail readability/i);
        const strategy = await readPrompt("visualStrategyCompression");
        assert.match(strategy, /Visual Strategy Compression Prompt v1\.0/);
        assert.match(strategy, /Final Visual Strategy Decision/);
        const planning = await readPrompt("visualPlanningV2");
        assert.match(planning, /Mobile Thumbnail Gate/);
        assert.match(planning, /Role Deduplication Gate/);
        assert.doesNotMatch(planning, /## C\. Single Image Prompt Pack/);
        assert.doesNotMatch(planning, /<<<IMAGE_01_PROMPT_START>>>/);
        assert.doesNotMatch(planning, /<<<IMAGE_10_PROMPT_END>>>/);
        const single = await readPrompt("singleImagePromptV2");
        assert.match(single, /<<<IMAGE_PROMPT_START>>>/);
        assert.match(single, /<<<IMAGE_PROMPT_END>>>/);
        assert.match(single, /Base Image Prompt/);
        assert.match(single, /Overlay Instruction/);
        assert.deepEqual(validateSingleImagePromptV2(single), {
            valid: true,
            errors: []
        });
        const qc = await readPrompt("listingImageQcV1");
        assert.match(qc, /Listing Image QC Prompt v1\.0/);
        assert.match(qc, /Product Identity Accuracy/);
        assert.match(qc, /Mobile Thumbnail Readability/);
    });
});
//# sourceMappingURL=prompt-files.test.js.map