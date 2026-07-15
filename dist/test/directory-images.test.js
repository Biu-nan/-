import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { importImagesToDirectory, scanImages } from "../src/directory-images.js";
describe("directory image storage", () => {
    it("allows identical liner content to be stored under different SKU names", async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), "liner-images-"));
        const png = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
        ]);
        try {
            const first = await importImagesToDirectory(directory, [{ originalname: "liner.png", buffer: png }], ["SKU-1"], { allowDuplicateContent: true });
            const second = await importImagesToDirectory(directory, [{ originalname: "liner.png", buffer: png }], ["SKU-2"], { allowDuplicateContent: true });
            assert.deepEqual(first.imported, ["SKU-1.png"]);
            assert.deepEqual(second.imported, ["SKU-2.png"]);
            assert.equal((await scanImages(directory, { preserveDuplicates: true })).length, 2);
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=directory-images.test.js.map