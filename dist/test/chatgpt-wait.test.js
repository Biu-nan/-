import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChatGptAdapter } from "../src/chatgpt-adapter.js";

describe("ChatGPT response waiting", () => {
    it("uses the native editor insertion path for a long prompt", async () => {
        const adapter = new ChatGptAdapter();
        let received;
        const prompt = "a".repeat(13_000);
        await adapter.insertComposerText({
            evaluate: async (_fn, value) => {
                received = value;
                return { written: true };
            }
        }, prompt);
        assert.equal(received, prompt);
    });
    it("does not upload the same image twice when ChatGPT resets its file input", async () => {
        const adapter = new ChatGptAdapter();
        const uploads = [];
        const imageInput = {
            count: async () => 1,
            isDisabled: async () => false,
            setInputFiles: async (paths) => uploads.push(paths)
        };
        const page = {
            locator: () => ({ first: () => imageInput })
        };
        adapter.requirePage = async () => page;
        adapter.composerAttachmentCount = async () => 0;
        adapter.checkImageUploadReady = async () => ({ ready: true });
        adapter.waitForAttachmentCount = async () => 1;
        adapter.clickAttachmentButton = async () => {
            throw new Error("不应对同一文件再次打开上传入口");
        };
        await adapter.uploadImages(["C:/tmp/bag.png"]);
        assert.deepEqual(uploads, [["C:/tmp/bag.png"]]);
    });
    it("reuses an image already attached to the composer", async () => {
        const adapter = new ChatGptAdapter();
        const page = {};
        adapter.requirePage = async () => page;
        adapter.composerAttachmentCount = async () => 1;
        await adapter.uploadImages(["C:/tmp/bag.png"]);
    });
    it("continues when the current ChatGPT UI has no standalone web-search menu", async () => {
        const adapter = new ChatGptAdapter();
        adapter.selectComposerTool = async () => {
            throw new Error("menu absent");
        };
        await assert.doesNotReject(() => adapter.enableWebSearch());
    });
    it("recognizes stopped thinking with no assistant output instead of waiting for the global timeout", async () => {
        const adapter = new ChatGptAdapter();
        const page = {
            locator: () => ({}),
            waitForTimeout: async () => undefined
        };
        adapter.requirePage = async () => page;
        adapter.stopButton = () => ({ isVisible: async () => false });
        adapter.messageSequence = async () => [];
        await assert.rejects(
            () => adapter.waitForResponseAfterPrompt("Research Prompt", {
                stoppedWithoutOutputGraceMs: 0
            }),
            { code: "CHATGPT_STOPPED_WITHOUT_OUTPUT" }
        );
        assert.equal(adapter.getWaitingState(), null);
    });
    it("honors a pause request before starting another polling cycle", async () => {
        const adapter = new ChatGptAdapter();
        const page = {
            locator: () => ({}),
            waitForTimeout: async () => undefined
        };
        adapter.requirePage = async () => page;
        adapter.messageSequence = async () => [];
        await assert.rejects(
            () => adapter.waitForResponseAfterPrompt("Research Prompt", {
                shouldPause: () => true
            }),
            { code: "WORKFLOW_PAUSED" }
        );
        assert.equal(adapter.getWaitingState(), null);
    });
});
