import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBagIdentificationData } from "../src/luxury-insert-service.js";
const valid = `报告正文
<<<BAG_IDENTIFICATION_DATA_START>>>
\`\`\`json
{
  "brand": "LOEWE",
  "bagFamily": "Puzzle",
  "primaryVariantId": "SKU-2",
  "variants": [
    {
      "id": "SKU-1",
      "label": "Mini",
      "bagDimensions": { "length": 18, "width": 8, "height": 12.5 },
      "publicSourceUrl": "https://example.com/mini",
      "version": "",
      "confidence": "High"
    },
    {
      "id": "SKU-2",
      "label": "Medium",
      "bagDimensions": { "length": 29, "width": 14, "height": 19.5 },
      "publicSourceUrl": "https://example.com/medium",
      "version": "Current",
      "confidence": "High"
    }
  ]
}
\`\`\`
<<<BAG_IDENTIFICATION_DATA_END>>>`;
describe("bag identification structured data", () => {
    it("parses brand, family, primary SKU and dimensions", () => {
        const result = parseBagIdentificationData(valid);
        assert.equal(result.brand, "LOEWE");
        assert.equal(result.bagFamily, "Puzzle");
        assert.equal(result.primaryVariantId, "SKU-2");
        assert.deepEqual(result.variants[0].bagDimensions, {
            length: 18,
            width: 8,
            height: 12.5
        });
    });
    it("rejects a missing structured data boundary", () => {
        assert.throws(() => parseBagIdentificationData("只有 Markdown 报告"), /缺少包型尺寸结构化数据/);
    });
    it("rejects a primary SKU outside the candidate list", () => {
        assert.throws(() => parseBagIdentificationData(valid.replace('"SKU-2",\n  "variants"', '"SKU-9",\n  "variants"')), /主推 SKU 不在候选列表/);
    });
    it("repairs common AI JSON formatting mistakes before validation", () => {
        const malformed = valid
            .replace('"brand": "LOEWE"', 'brand: “LOEWE”')
            .replace('"confidence": "High"\n    }', '"confidence": "High",\n    }');
        const result = parseBagIdentificationData(malformed);
        assert.equal(result.brand, "LOEWE");
        assert.equal(result.variants.length, 2);
    });
});
//# sourceMappingURL=bag-identification.test.js.map