import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { platform } from "node:os";
import { SleepInhibitor } from "../src/sleep-inhibitor.js";

describe("sleep inhibitor", () => {
    it("does not try to start macOS caffeinate on non-macOS hosts", () => {
        const inhibitor = new SleepInhibitor();
        inhibitor.acquire();
        if (platform() !== "darwin") {
            assert.equal(inhibitor.isActive(), false);
        }
        inhibitor.stop();
    });
});
