import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StoryboardGateService, validatePromptPackAgainstStoryboard, validateStoryboardGate } from "../src/storyboard-gate-service.js";
import { validatePromptPack } from "../src/prompt-files.js";
const roles = [
    ["Hero Hook", "What is this product?", "attention", "Personalized plush keychain", "front face print and full keychain structure", "Carry a Little Memory Everywhere"],
    ["Pain Point", "Why is it more meaningful than a normal gift?", "interest", "Emotional photo keepsake", "photo card cue and face print area", "Turn a Photo Into a Smile"],
    ["Core Feature", "How does it attach?", "proof", "Gold clasp attachment", "gold keyring and lobster clasp", "Clips Easily to Keys or Bags"],
    ["Material Detail", "Does it feel soft?", "proof", "Soft plush texture", "orange plush fibers and scarf detail", "Soft Plush, Sweet Details"],
    ["Use Demo", "How do I use it?", "usage", "Bag charm use", "product clipped to a bag strap", "Made for Bags, Keys & Backpacks"],
    ["Benefit Infographic", "What are the quick benefits?", "comparison", "Portable daily charm", "three benefit badges and full product", "Cute. Personal. Easy to Carry."],
    ["Gift Angle", "Is it giftable?", "desire", "Small thoughtful gift", "blank gift card and ribbon cue", "A Tiny Gift With a Big Reaction"],
    ["Lifestyle Scene", "Can I carry it daily?", "usage", "Everyday carry memory", "keys and pouch around the product", "Your Favorite Face, Always Close"],
    ["Emotional Scene", "Will it feel fun and personal?", "desire", "Funny personal charm", "cozy fabric and memory card cue", "Funny, Sweet, and Personal"],
    ["Trust Summary", "Why should I buy now?", "decision", "Final purchase reasons", "reason chips around exact product", "One Charm. Three Reasons to Love It."]
];
function promptPack(overrides = {}) {
    return roles.map((row, index) => {
        const number = String(index + 1).padStart(2, "0");
        const override = overrides[index + 1] || {};
        const role = override.role || row[0];
        const buyerQuestion = override.buyerQuestion || row[1];
        const funnelStage = override.funnelStage || row[2];
        const core = override.core || row[3];
        const proof = override.proof || row[4];
        const headline = override.headline || row[5];
        const finalPrompt = override.prompt ||
            `The product being sold must exactly match the uploaded product images. Create Image ${number} only. Use the visual proof: ${proof}.`;
        return [
            `<<<IMAGE_${number}_PROMPT_START>>>`,
            `## Image ${number}｜${role}｜Ready-to-Generate Prompt`,
            `- Funnel Stage: ${funnelStage}`,
            `- Buyer Question: ${buyerQuestion}`,
            `- Core Selling Point: ${core}`,
            `- Visual Proof: ${proof}`,
            `- English Copy on Image: ${headline}`,
            `- Final Image Generation Prompt: ${finalPrompt}`,
            `<<<IMAGE_${number}_PROMPT_END>>>`
        ].join("\n");
    }).join("\n\n");
}
describe("storyboard gate service", () => {
    it("builds and accepts a complete non-duplicated storyboard from a prompt pack", () => {
        const service = new StoryboardGateService();
        const gate = service.buildFromPromptPack({
            productId: "product-1",
            planningText: promptPack()
        });
        assert.equal(gate.items.length, 10);
        assert.equal(gate.qc_summary.can_generate_prompt_pack, true);
        assert.deepEqual(validateStoryboardGate(gate).errors, []);
    });
    it("rejects duplicated core selling points before image generation", () => {
        const service = new StoryboardGateService();
        const gate = service.buildFromPromptPack({
            productId: "product-1",
            planningText: promptPack({
                2: { core: "Personalized plush keychain" }
            })
        });
        const validation = validateStoryboardGate(gate);
        assert.equal(validation.valid, false);
        assert.match(validation.errors.join("\n"), /core_selling_point/);
    });
    it("rejects prompt packs that do not match the storyboard gate", () => {
        const service = new StoryboardGateService();
        const original = promptPack();
        const gate = service.buildFromPromptPack({
            productId: "product-1",
            planningText: original
        });
        const polluted = promptPack({
            1: {
                prompt: "The product being sold must exactly match the uploaded product images. Create a collage grid with Image 02 and Image 03 together."
            }
        });
        const validation = validatePromptPackAgainstStoryboard(polluted, gate);
        assert.equal(validation.valid, false);
        assert.match(validation.errors.join("\n"), /forbidden multi-image term|other image number/);
    });
    it("parses split storyboard gate JSON without relying on prompt pack markers", () => {
        const service = new StoryboardGateService();
        const gate = service.buildFromPromptPack({
            productId: "product-1",
            planningText: promptPack()
        });
        const parsed = service.parseStoryboardGate([
            "<<<STORYBOARD_GATE_JSON_START>>>",
            JSON.stringify(gate),
            "<<<STORYBOARD_GATE_JSON_END>>>"
        ].join("\n"));
        assert.equal(parsed.product_id, "product-1");
        assert.equal(parsed.items.length, 10);
        assert.equal(parsed.qc_summary.can_generate_prompt_pack, true);
    });
    it("parses split storyboard QC JSON separately from prompt pack generation", () => {
        const service = new StoryboardGateService();
        const parsed = service.parseStoryboardQc([
            "<<<STORYBOARD_QC_JSON_START>>>",
            JSON.stringify({
                valid: true,
                qc_status: "pass",
                errors: [],
                warnings: ["manual review still required"],
                block_next_images: false,
                regenerate_required: false
            }),
            "<<<STORYBOARD_QC_JSON_END>>>"
        ].join("\n"));
        assert.equal(parsed.valid, true);
        assert.equal(parsed.qc_status, "pass");
        assert.deepEqual(parsed.warnings, ["manual review still required"]);
    });
    it("normalizes object-shaped storyboard QC issues into readable strings", () => {
        const service = new StoryboardGateService();
        const parsed = service.parseStoryboardQc([
            "<<<STORYBOARD_QC_JSON_START>>>",
            JSON.stringify({
                valid: false,
                qc_status: "failed",
                errors: [
                    {
                        type: "semantic_overlap",
                        image_numbers: ["05", "08"],
                        field: "core_selling_point",
                        issue: "Two images repeat the same buyer reason."
                    }
                ],
                warnings: [
                    {
                        type: "claim_boundary",
                        image_numbers: ["10"],
                        issue: "Trust summary must not add unconfirmed claims."
                    }
                ],
                block_next_images: true,
                regenerate_required: true
            }),
            "<<<STORYBOARD_QC_JSON_END>>>"
        ].join("\n"));
        assert.deepEqual(parsed.errors, [
            "semantic_overlap | Image 05, 08 | core_selling_point | Two images repeat the same buyer reason."
        ]);
        assert.deepEqual(parsed.warnings, [
            "claim_boundary | Image 10 | Trust summary must not add unconfirmed claims."
        ]);
    });
    it("blocks a complete but sales-flow-confused prompt pack against storyboard", () => {
        const service = new StoryboardGateService();
        const gate = service.buildFromPromptPack({
            productId: "product-1",
            planningText: promptPack()
        });
        const confused = promptPack({
            2: {
                core: "Personalized plush keychain",
                proof: "front face print and full keychain structure",
                headline: "Carry a Little Memory Everywhere"
            }
        });
        assert.equal(validatePromptPack(confused).valid, true);
        const validation = validatePromptPackAgainstStoryboard(confused, gate);
        assert.equal(validation.valid, false);
        assert.match(validation.errors.join("\n"), /core_selling_point|visual_proof|headline/);
    });
});
//# sourceMappingURL=storyboard-gate-service.test.js.map