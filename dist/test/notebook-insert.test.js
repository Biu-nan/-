import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNotebookInsertData } from "../src/luxury-insert-service.js";
const variants = [
    {
        id: "SKU-1",
        label: "Mini",
        bagDimensions: { length: 18, width: 8, height: 12.5 }
    },
    {
        id: "SKU-2",
        label: "Medium",
        bagDimensions: { length: 29, width: 14, height: 19.5 }
    }
];
const result = `<<<NOTEBOOK_INSERT_PLAN_START>>>
完整方案
<<<NOTEBOOK_INSERT_PLAN_END>>>
<<<NOTEBOOK_INSERT_DATA_START>>>
\`\`\`json
{
  "variants": [
    {
      "id": "SKU-1",
      "designDecision": "REUSE_STOCK",
      "inventorySku": "LINER-001",
      "insertDimensions": { "length": 16, "width": 7, "height": 9 },
      "material": "Felt",
      "color": "Beige",
      "structure": "One main compartment",
      "weightGrams": 48,
      "fitClearance": "1 cm",
      "designRisks": "None"
    },
    {
      "id": "SKU-2",
      "designDecision": "NEW_DESIGN",
      "inventorySku": "",
      "insertDimensions": { "length": 26, "width": 12, "height": 10 },
      "material": "Felt",
      "color": "Beige",
      "structure": "Main compartment with zipper pocket",
      "weightGrams": null,
      "fitClearance": "1.5 cm",
      "designRisks": "Confirm opening clearance"
    }
  ]
}
\`\`\`
<<<NOTEBOOK_INSERT_DATA_END>>>`;
describe("NotebookLM insert structured data", () => {
    it("merges every planned SKU into the confirmed bag variants", () => {
        const planned = parseNotebookInsertData(result, variants);
        assert.equal(planned[0].inventorySku, "LINER-001");
        assert.equal(planned[0].designDecision, "REUSE_STOCK");
        assert.deepEqual(planned[1].insertDimensions, {
            length: 26,
            width: 12,
            height: 10
        });
        assert.equal(planned[1].weightGrams, undefined);
        assert.equal(planned[1].label, "Medium");
    });
    it("rejects a response without the structured boundary", () => {
        assert.throws(() => parseNotebookInsertData("只有规划报告", variants), /缺少内胆方案结构化数据/);
    });
    it("rejects a missing confirmed SKU", () => {
        const missing = result.replace(/,\n    \{\n      "id": "SKU-2"[\s\S]*?\n    \}/, "");
        assert.throws(() => parseNotebookInsertData(missing, variants), /缺少 SKU：SKU-2/);
    });
    it("rejects an insert larger than the confirmed bag", () => {
        const oversized = result.replace('"length": 26, "width": 12, "height": 10', '"length": 30, "width": 12, "height": 10');
        assert.throws(() => parseNotebookInsertData(oversized, variants), /内胆尺寸超出外包尺寸/);
    });
});
//# sourceMappingURL=notebook-insert.test.js.map