import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectImageExtension, hashBuffer, isPrivateAddress, isSupportedImage } from "../src/image-files.js";
describe("image file utilities", () => {
    it("accepts the four supported image extensions case-insensitively", () => {
        assert.equal(isSupportedImage("one.jpg"), true);
        assert.equal(isSupportedImage("two.JPEG"), true);
        assert.equal(isSupportedImage("three.png"), true);
        assert.equal(isSupportedImage("four.WEBP"), true);
        assert.equal(isSupportedImage("notes.txt"), false);
    });
    it("returns the same hash for duplicate file content", () => {
        const first = hashBuffer(Buffer.from("same-image"));
        const second = hashBuffer(Buffer.from("same-image"));
        const different = hashBuffer(Buffer.from("different-image"));
        assert.equal(first, second);
        assert.notEqual(first, different);
    });
    it("detects supported image types from file signatures", () => {
        assert.equal(detectImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0x00])), ".jpg");
        assert.equal(detectImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), ".png");
        assert.equal(detectImageExtension(Buffer.from("RIFF0000WEBP")), ".webp");
        assert.equal(detectImageExtension(Buffer.from("<svg></svg>")), undefined);
    });
    it("blocks local and private network addresses", () => {
        assert.equal(isPrivateAddress("127.0.0.1"), true);
        assert.equal(isPrivateAddress("192.168.1.2"), true);
        assert.equal(isPrivateAddress("10.0.0.4"), true);
        assert.equal(isPrivateAddress("::1"), true);
        assert.equal(isPrivateAddress("8.8.8.8"), false);
    });
});
//# sourceMappingURL=image-files.test.js.map