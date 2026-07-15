import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { insertGenerationReferenceImagePaths, insertDimensionConflict, parseMarketRadarCandidates, resetInsertMarketRadarState } from "../src/luxury-insert-service.js";
function variant(insertLength) {
    return {
        id: "SKU-1",
        label: "Medium",
        bagDimensions: { length: 29, width: 14, height: 19.5 },
        insertDimensions: { length: insertLength, width: 12, height: 10 }
    };
}
describe("luxury insert dimensions", () => {
    it("accepts an insert that fits inside the confirmed bag dimensions", () => {
        assert.equal(insertDimensionConflict(variant(26)), undefined);
    });
    it("rejects an insert dimension larger than the confirmed bag", () => {
        assert.equal(insertDimensionConflict(variant(33)), "Medium 内胆尺寸超出外包尺寸");
    });
});
describe("luxury insert market radar structured data", () => {
    function response(overrides = {}) {
        return `# Report

<<<MARKET_RADAR_DATA_START>>>
{
  "generatedAt": "2026-06-16",
  "candidates": [
    {
      "rank": 1,
      "bagModel": "Coach Brooklyn Shoulder Bag",
      "brand": "Coach",
      "bagFamily": "Brooklyn Shoulder Bag",
      "sizeVersion": "39",
      "parentCategory": "Slouchy Shoulder Bag",
      "evidenceLevel": ${JSON.stringify(overrides.evidenceLevel ?? "E5")},
      "heatType": "Commerce Verified",
      "nativeOrganizationLevel": ${JSON.stringify(overrides.nativeOrganizationLevel ?? "Low")},
      "builtInFeatures": ["Open cavity", "Minimal pocket only"],
      "painGap": "Large slouchy open space, items roll around",
      "insertValueType": ["Organization Value", "Shape Support Value"],
      "organizerPotential": ${JSON.stringify(overrides.organizerPotential ?? "High")},
      "inventoryReusePotential": ${JSON.stringify(overrides.inventoryReusePotential ?? "Medium")},
      "riskFlags": ["IP Risk", "Size Risk"],
      "officialFrontImageUrl": "https://example.com/front.jpg",
      "officialProductUrl": "https://example.com/product",
      "listingSafeAngle": "Large slouch shoulder bag organizer",
      "poolTier": ${JSON.stringify(overrides.poolTier ?? "P0")},
      "nextStep": "Size Match First",
      "sourceEvidence": "Sales volume unavailable. Using observable proxies.",
      "whyP0": "Strong evidence and clear pain gap"
    }
  ]
}
<<<MARKET_RADAR_DATA_END>>>`;
    }
    it("parses market radar candidates and creates a stable candidate id", () => {
        const [candidate] = parseMarketRadarCandidates(response());
        assert.equal(candidate.bagModel, "Coach Brooklyn Shoulder Bag");
        assert.equal(candidate.poolTier, "P0");
        assert.equal(candidate.nativeOrganizationLevel, "Low");
        assert.equal(candidate.officialFrontImageUrl, "https://example.com/front.jpg");
        assert.equal(candidate.candidateId.length, 16);
    });
    it("rejects a market radar response without structured boundaries", () => {
        assert.throws(() => parseMarketRadarCandidates("# markdown only"), /缺少开发候选结构化数据/);
    });
    it("rejects invalid market radar enum values", () => {
        assert.throws(() => parseMarketRadarCandidates(response({ poolTier: "Enter" })), /Pool Tier/);
    });
});
describe("luxury insert market radar reset", () => {
    it("clears market radar selection state only when reset manually", () => {
        const reset = resetInsertMarketRadarState({
            marketRadarText: "# radar",
            marketRadarUpdatedAt: "2026-07-06T00:00:00.000Z",
            marketRadarChatUrl: "https://chatgpt.com/c/test",
            marketRadarCandidates: [{
                    candidateId: "candidate-1",
                    rank: 1,
                    bagModel: "Coach Brooklyn",
                    brand: "Coach",
                    bagFamily: "Brooklyn",
                    sizeVersion: "39",
                    parentCategory: "Shoulder Bag",
                    evidenceLevel: "E5",
                    heatType: "Commerce Verified",
                    nativeOrganizationLevel: "Low",
                    builtInFeatures: [],
                    painGap: "Open cavity",
                    insertValueType: ["Organization Value"],
                    organizerPotential: "High",
                    inventoryReusePotential: "Medium",
                    riskFlags: [],
                    officialFrontImageUrl: "https://example.com/front.jpg",
                    officialProductUrl: "https://example.com/product",
                    listingSafeAngle: "Organizer insert",
                    poolTier: "P0",
                    nextStep: "Size Match First",
                    sourceEvidence: "Evidence",
                    whyP0: "Clear demand"
                }],
            selectedMarketRadarCandidateId: "candidate-1",
            marketRadarSelectionWarning: "需要人工上传外包图"
        });
        assert.equal(reset, undefined);
    });
});
describe("luxury insert image generation references", () => {
    const insert = {
        primaryVariantId: "SKU-1",
        variants: [
            {
                id: "SKU-1",
                label: "Primary",
                bagDimensions: { length: 29, width: 14, height: 19.5 },
                linerImageName: "primary.png"
            },
            {
                id: "SKU-2",
                label: "Large",
                bagDimensions: { length: 35, width: 16, height: 24 },
                linerImageName: "large.png"
            }
        ]
    };
    const bagImages = [
        { name: "front.png", path: "/tmp/front.png" },
        { name: "side.png", path: "/tmp/side.png" }
    ];
    const linerImages = [
        { name: "primary.png", path: "/tmp/primary.png" },
        { name: "large.png", path: "/tmp/large.png" }
    ];
    it("uses target bag references and the primary liner for Image 01-06", () => {
        assert.deepEqual(insertGenerationReferenceImagePaths(insert, 1, bagImages, linerImages), ["/tmp/front.png", "/tmp/side.png", "/tmp/primary.png"]);
    });
    it("uses target bag references and all liner SKUs for Image 07", () => {
        assert.deepEqual(insertGenerationReferenceImagePaths(insert, 7, bagImages, linerImages), ["/tmp/front.png", "/tmp/side.png", "/tmp/primary.png", "/tmp/large.png"]);
    });
    it("blocks generation when a required liner reference is missing", () => {
        assert.throws(() => insertGenerationReferenceImagePaths(insert, 1, bagImages, []), /Primary 缺少内胆参考图/);
    });
});
//# sourceMappingURL=luxury-insert.test.js.map