import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { CHROME_DEBUG_PORT, CHROME_PATH, CHROME_PROFILE_DIR } from "./config.js";
const GEMINI_URL = "https://gemini.google.com/app";
const RESPONSE_WAIT_MS = 10 * 60_000;
export class GeminiAdapter {
    browser;
    context;
    page;
    async launch() {
        if (this.browser?.isConnected() && this.page && !this.page.isClosed()) {
            await this.page.bringToFront();
            return this.page;
        }
        await access(CHROME_PATH);
        const context = await this.connectToChrome().catch(async () => {
            this.startNormalChrome();
            await this.waitForChromeDebugPort();
            return this.connectToChrome();
        });
        this.page =
            context.pages().find((candidate) => candidate.url().includes("gemini.google.com")) ?? (await context.newPage());
        if (!this.page.url().includes("gemini.google.com")) {
            await this.page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });
        }
        await this.page.bringToFront();
        return this.page;
    }
    async checkReady() {
        if (!this.page || this.page.isClosed())
            await this.launch();
        const page = await this.requirePage();
        const ready = await this.composer(page)
            .waitFor({ state: "visible", timeout: 15_000 })
            .then(() => true)
            .catch(() => false);
        if (ready)
            return { ready: true, status: "ready", url: page.url() };
        const text = await page.locator("body").innerText().catch(() => "");
        const verificationRequired = /verify you are human|真人验证|checking your browser|安全验证/i.test(text);
        return {
            ready: false,
            status: verificationRequired
                ? "verification_required"
                : "login_required",
            url: page.url()
        };
    }
    async createBlankChat() {
        const page = await this.requirePage();
        await page.goto(GEMINI_URL, {
            waitUntil: "domcontentloaded",
            timeout: 60_000
        });
        await this.composer(page).waitFor({ state: "visible", timeout: 30_000 });
        return page.url();
    }
    async openChat(chatUrl) {
        await this.launch();
        if (!chatUrl.startsWith("https://gemini.google.com/app/")) {
            throw new Error("没有可继续的 Gemini 商品对话");
        }
        const page = await this.requirePage();
        if (page.url() !== chatUrl) {
            await page.goto(chatUrl, {
                waitUntil: "domcontentloaded",
                timeout: 60_000
            });
        }
        await this.composer(page).waitFor({ state: "visible", timeout: 30_000 });
        await page.bringToFront();
        return page.url();
    }
    async uploadImages(paths) {
        const page = await this.requirePage();
        const uploadButton = page
            .locator('button[aria-label="上传和工具"]:visible, button[aria-label="Upload and tools"]:visible')
            .first();
        await uploadButton.waitFor({ state: "visible", timeout: 15_000 });
        await uploadButton.click();
        const uploadMenuItem = page
            .locator('[data-test-id="local-images-files-uploader-button"]:visible, [role="menuitem"][aria-label^="上传文件"]:visible, [role="menuitem"][aria-label^="Upload files"]:visible')
            .first();
        await uploadMenuItem.waitFor({ state: "visible", timeout: 10_000 });
        const fileChooserPromise = page.waitForEvent("filechooser", {
            timeout: 10_000
        });
        await uploadMenuItem.click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(paths);
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
            const counts = await Promise.all([
                page
                    .locator('button[aria-label*="移除文件"], button[aria-label*="Remove file"]')
                    .count(),
                page
                    .locator("uploader-file-preview, .file-preview-chip, .gem-attachment, .attachment-preview-wrapper")
                    .count()
            ]);
            if (Math.max(...counts) >= paths.length)
                return;
            await page.waitForTimeout(1_000);
        }
        throw new Error(`Gemini 图片上传未完成：未检测到 ${paths.length} 个附件`);
    }
    async enableWebSearch() {
        // Gemini responses use Google Search grounding when available.
    }
    async enableImageCreation() {
        // Gemini accepts image creation instructions directly in the composer.
    }
    async sendPromptOnce(prompt, fingerprint) {
        const page = await this.requirePage();
        const assistantCount = await this.assistantMessages(page).count();
        const userMessages = this.userMessages(page);
        const userCount = await userMessages.count();
        await this.composer(page).fill(prompt);
        const sendButton = this.sendButton(page);
        await sendButton.waitFor({ state: "visible", timeout: 15_000 });
        await sendButton.click();
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            const nextUserCount = await userMessages.count();
            const stopVisible = await this.stopButton(page)
                .isVisible()
                .catch(() => false);
            if (nextUserCount > userCount || stopVisible)
                return assistantCount;
            await page.waitForTimeout(500);
        }
        throw new Error(`无法确认 Prompt 是否发送到 Gemini：${fingerprint}。流程不会自动重发。`);
    }
    async hasUserPrompt(fingerprint) {
        const users = this.userMessages(await this.requirePage());
        const count = await users.count();
        for (let index = count - 1; index >= 0; index -= 1) {
            if ((await users.nth(index).innerText().catch(() => "")).includes(fingerprint)) {
                return true;
            }
        }
        return false;
    }
    async recoverCompletedResponse(fingerprint) {
        const page = await this.requirePage();
        if (await this.stopButton(page).isVisible().catch(() => false)) {
            return undefined;
        }
        return this.responseAfterFingerprint(page, fingerprint);
    }
    async waitForResponseAfterPrompt(fingerprint) {
        const page = await this.requirePage();
        const deadline = Date.now() + RESPONSE_WAIT_MS;
        let stableText = "";
        let stableSince = 0;
        while (Date.now() < deadline) {
            const response = await this.responseAfterFingerprint(page, fingerprint);
            const stopped = !(await this.stopButton(page)
                .isVisible()
                .catch(() => false));
            if (response && stopped) {
                if (response !== stableText) {
                    stableText = response;
                    stableSince = Date.now();
                }
                else if (Date.now() - stableSince >= 3_000) {
                    return response;
                }
            }
            else {
                stableSince = 0;
            }
            await page.waitForTimeout(1_000);
        }
        throw new Error(`等待 Gemini 回复超时：${fingerprint}`);
    }
    async waitForGeneratedImageAndDownload(previousGeneratedImageCount, outputPath) {
        const page = await this.requirePage();
        const deadline = Date.now() + 8 * 60_000;
        let detectedAt = 0;
        const initialPageImageCount = await this.generatedImages(page).count();
        const pageBaseline = previousGeneratedImageCount > initialPageImageCount
            ? Math.max(0, initialPageImageCount - 1)
            : previousGeneratedImageCount;
        while (Date.now() < deadline) {
            if (await access(outputPath).then(() => true).catch(() => false))
                return;
            const images = this.generatedImages(page);
            const count = await images.count();
            const stopped = !(await this.stopButton(page)
                .isVisible()
                .catch(() => false));
            if (stopped && count > pageBaseline) {
                detectedAt ||= Date.now();
                if (Date.now() - detectedAt >= 3_000) {
                    await this.saveGeneratedImage(images.nth(count - 1), outputPath);
                    return;
                }
            }
            else {
                detectedAt = 0;
            }
            await page.waitForTimeout(1_000);
        }
        throw new Error("等待 Gemini 图片生成完成超时（8 分钟）");
    }
    async generatedImageCount() {
        return this.generatedImages(await this.requirePage()).count();
    }
    async saveLatestCompletedGeneratedImage(outputPath, previousGeneratedImageCount = 0) {
        const page = await this.requirePage();
        if (await this.stopButton(page).isVisible().catch(() => false))
            return false;
        const images = this.generatedImages(page);
        const count = await images.count();
        if (count <= previousGeneratedImageCount)
            return false;
        await this.saveGeneratedImage(images.nth(count - 1), outputPath);
        return true;
    }
    async recoverCompletedGeneratedImages(outputDirectory, knownImageNumbers) {
        const recovered = new Set(knownImageNumbers);
        const images = this.generatedImages(await this.requirePage());
        const count = Math.min(await images.count(), 10);
        const missingNumbers = Array.from({ length: 10 }, (_, index) => index + 1).filter((number) => !recovered.has(number));
        for (let index = 0; index < count; index += 1) {
            const number = missingNumbers[index];
            if (!number)
                break;
            await this.saveGeneratedImage(images.nth(index), path.join(outputDirectory, `Image_${String(number).padStart(2, "0")}.png`));
            recovered.add(number);
        }
        return [...recovered].sort((a, b) => a - b);
    }
    currentUrl() {
        return this.page && !this.page.isClosed() ? this.page.url() : undefined;
    }
    async responseAfterFingerprint(page, fingerprint) {
        const users = this.userMessages(page);
        const assistants = this.assistantMessages(page);
        const userCount = await users.count();
        const assistantCount = await assistants.count();
        for (let index = userCount - 1; index >= 0; index -= 1) {
            const text = await users.nth(index).innerText().catch(() => "");
            if (!text.includes(fingerprint))
                continue;
            return assistantCount
                ? (await assistants.nth(assistantCount - 1).innerText().catch(() => ""))
                    .trim() || undefined
                : undefined;
        }
        return undefined;
    }
    composer(page) {
        return page
            .locator('rich-textarea [contenteditable="true"], .ql-editor[contenteditable="true"], textarea[aria-label*="prompt"], textarea[placeholder*="Gemini"]')
            .first();
    }
    sendButton(page) {
        return page
            .locator('button.send-button, button[aria-label*="发送"], button[aria-label*="Send"]')
            .first();
    }
    stopButton(page) {
        return page
            .locator('button.stop-button, button[aria-label*="停止"], button[aria-label*="Stop"]')
            .first();
    }
    userMessages(page) {
        return page.locator('.user-query-container, user-query, [data-test-id="user-query"]');
    }
    assistantMessages(page) {
        return page.locator('.model-response-text, model-response, [data-test-id="model-response"]');
    }
    generatedImages(page) {
        return page.locator('.model-response img[src*="googleusercontent"], generated-image img, .generated-image img');
    }
    async saveGeneratedImage(image, outputPath) {
        const metadata = await image.evaluate((element) => {
            const img = element;
            return {
                src: img.currentSrc || img.src,
                width: img.naturalWidth,
                height: img.naturalHeight
            };
        });
        if (!metadata.src || metadata.width < 300 || metadata.height < 300) {
            throw new Error("已检测到 Gemini 图片，但无法读取高清资源");
        }
        const page = await this.requirePage();
        let bytes;
        if (metadata.src.startsWith("blob:")) {
            const base64 = await image.evaluate((element) => {
                const img = element;
                const canvas = document.createElement("canvas");
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const context = canvas.getContext("2d");
                if (!context)
                    throw new Error("无法创建图片画布");
                context.drawImage(img, 0, 0, canvas.width, canvas.height);
                return canvas.toDataURL("image/png").split(",", 2)[1];
            });
            bytes = Buffer.from(base64, "base64");
        }
        else {
            const response = await page.context().request.get(metadata.src);
            if (!response.ok()) {
                throw new Error(`Gemini 图片下载失败：HTTP ${response.status()}`);
            }
            bytes = await response.body();
        }
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, bytes);
    }
    async requirePage() {
        if (!this.page || this.page.isClosed()) {
            throw new Error("专用 Chrome 尚未启动，请先连接 Gemini");
        }
        return this.page;
    }
    async connectToChrome() {
        this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);
        this.context = this.browser.contexts()[0];
        if (!this.context)
            throw new Error("Chrome 没有可用浏览器上下文");
        return this.context;
    }
    startNormalChrome() {
        const child = spawn(CHROME_PATH, [
            `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
            `--user-data-dir=${CHROME_PROFILE_DIR}`,
            "--no-first-run",
            "--no-default-browser-check",
            "--start-maximized",
            GEMINI_URL
        ], { detached: true, stdio: "ignore" });
        child.unref();
    }
    async waitForChromeDebugPort() {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            const ready = await fetch(`http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`)
                .then((response) => response.ok)
                .catch(() => false);
            if (ready)
                return;
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw new Error("普通 Chrome 启动超时");
    }
}
//# sourceMappingURL=gemini-adapter.js.map