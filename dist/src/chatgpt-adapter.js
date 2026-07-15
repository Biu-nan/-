import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { CHATGPT_URL, CHROME_DEBUG_PORT, CHROME_PATH, CHROME_PROFILE_DIR } from "./config.js";
const LOGIN_WAIT_MS = 15_000;
const CHROME_START_WAIT_MS = 30_000;
const UPLOAD_WAIT_MS = 90_000;
const RESPONSE_WAIT_MS = 10 * 60_000;
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export class ChatGptAdapter {
    browser;
    context;
    page;
    async launch() {
        if (this.browser?.isConnected() &&
            this.page &&
            !this.page.isClosed()) {
            await this.page.bringToFront();
            return this.page;
        }
        this.page = undefined;
        this.context = undefined;
        this.browser = undefined;
        await access(CHROME_PATH);
        const context = await this.connectToChrome().catch(async () => {
            this.startNormalChrome();
            await this.waitForChromeDebugPort();
            return this.connectToChrome();
        });
        this.page =
            context.pages().find((candidate) => candidate.url().includes("chatgpt.com")) ?? context.pages()[0] ?? (await context.newPage());
        if (!this.page.url().includes("chatgpt.com")) {
            await this.page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded" });
        }
        await this.page.bringToFront();
        return this.page;
    }
    async checkReady() {
        if (!this.page || this.page.isClosed()) {
            await this.launch();
        }
        const page = await this.requirePage();
        const composer = this.composer(page);
        const ready = await composer
            .waitFor({ state: "visible", timeout: LOGIN_WAIT_MS })
            .then(() => true)
            .catch(() => false);
        if (ready) {
            return { ready: true, status: "ready", url: page.url() };
        }
        const pageText = await page
            .locator("body")
            .innerText({ timeout: 5_000 })
            .catch(() => "");
        const verificationRequired = /verify you are human|真人验证|验证您是真人|checking your browser|执行安全验证/i.test(pageText);
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
        await page.goto(CHATGPT_URL, {
            waitUntil: "domcontentloaded",
            timeout: 60_000
        });
        await this.composer(page).waitFor({
            state: "visible",
            timeout: 30_000
        });
        return page.url();
    }
    async openChat(chatUrl) {
        await this.launch();
        const page = await this.requirePage();
        if (!chatUrl.startsWith("https://chatgpt.com/c/")) {
            throw new Error("没有可继续的商品对话 URL，请先完成 MVP 1");
        }
        if (page.url() !== chatUrl) {
            await page.goto(chatUrl, {
                waitUntil: "domcontentloaded",
                timeout: 60_000
            });
        }
        await this.composer(page).waitFor({
            state: "visible",
            timeout: 30_000
        });
        await page.bringToFront();
        return page.url();
    }
    async uploadImages(paths) {
        const page = await this.requirePage();
        let input = page.locator('input[type="file"]').first();
        if ((await input.count()) === 0) {
            await this.clickAttachmentButton(page);
            input = page.locator('input[type="file"]').first();
            await input.waitFor({ state: "attached", timeout: 10_000 });
        }
        await input.setInputFiles(paths);
        await this.waitForAttachmentCount(page, paths.length);
    }
    async enableWebSearch() {
        await this.selectComposerTool("网页搜索", [
            "搜索网页",
            "Search the web"
        ]);
    }
    async enableImageCreation() {
        await this.selectComposerTool("创建图片", [
            "描述图片",
            "描述或编辑图片",
            "Describe an image"
        ]);
    }
    async selectComposerTool(toolName, expectedPlaceholders) {
        const page = await this.requirePage();
        const plusButton = page.locator('button[data-testid="composer-plus-btn"]');
        await plusButton.waitFor({ state: "visible", timeout: 15_000 });
        let toolOption = await this.findComposerToolOption(page, toolName, 300);
        if (!toolOption) {
            await plusButton.click();
            toolOption = await this.findComposerToolOption(page, toolName);
        }
        if (!toolOption) {
            const menuText = await page.locator('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper"]')
                .first()
                .innerText({ timeout: 1_000 })
                .catch(() => "");
            throw new Error(`找不到 ChatGPT 工具菜单项“${toolName}”。当前菜单内容：${menuText || "未读取到菜单内容"}`);
        }
        const checked = (await toolOption.getAttribute("aria-checked").catch(() => null)) ??
            (await toolOption.getAttribute("aria-pressed").catch(() => null));
        if (checked !== "true") {
            await toolOption.click();
        }
        else {
            await page.keyboard.press("Escape");
        }
        const placeholderSelector = expectedPlaceholders
            .map((placeholder) => `#prompt-textarea [data-placeholder="${placeholder}"]`)
            .join(", ");
        const selectedIndicator = page.locator(placeholderSelector);
        const placeholderVisible = await selectedIndicator
            .waitFor({ state: "visible", timeout: 6_000 })
            .then(() => true)
            .catch(() => false);
        if (placeholderVisible)
            return;
        const exactName = new RegExp(`^\\s*${escapeRegex(toolName)}\\s*$`, "i");
        const toolChip = page
            .locator('button, [role="button"], [aria-label], [data-testid*="tool"], [data-testid*="composer"]')
            .filter({ hasText: exactName })
            .first();
        const chipVisible = await toolChip
            .waitFor({ state: "visible", timeout: 2_000 })
            .then(() => true)
            .catch(() => false);
        if (!chipVisible) {
            throw new Error(`无法确认 ChatGPT“${toolName}”已启用`);
        }
    }
    async findComposerToolOption(page, toolName, timeout = 1_500) {
        const exactName = new RegExp(`^\\s*${escapeRegex(toolName)}\\s*$`, "i");
        const candidates = [
            page.getByRole("menuitemradio", { name: toolName, exact: true }),
            page.getByRole("menuitem", { name: toolName, exact: true }),
            page.getByRole("option", { name: toolName, exact: true }),
            page.getByRole("button", { name: toolName, exact: true }),
            page.getByText(toolName, { exact: true }),
            page
                .locator('[role="menuitemradio"], [role="menuitem"], [role="option"], button, [role="button"], div, span')
                .filter({ hasText: exactName })
                .first()
        ];
        for (const candidate of candidates) {
            const visible = await candidate
                .waitFor({ state: "visible", timeout })
                .then(() => true)
                .catch(() => false);
            if (visible)
                return candidate;
        }
        return undefined;
    }
    async waitForGeneratedImageAndDownload(previousGeneratedImageCount, outputPath) {
        const page = await this.requirePage();
        const deadline = Date.now() + 8 * 60_000;
        let detectedAt;
        while (Date.now() < deadline) {
            const alreadySaved = await access(outputPath)
                .then(() => true)
                .catch(() => false);
            if (alreadySaved)
                return;
            const stopVisible = await this.stopButton(page)
                .isVisible()
                .catch(() => false);
            const generatedImages = this.generatedImages(page);
            const generatedImageCount = await generatedImages.count();
            if (!stopVisible &&
                generatedImageCount > previousGeneratedImageCount) {
                detectedAt ??= Date.now();
                if (Date.now() - detectedAt >= 3_000) {
                    await this.saveGeneratedImage(generatedImages.nth(generatedImageCount - 1), outputPath);
                    return;
                }
            }
            else {
                detectedAt = undefined;
            }
            await page.waitForTimeout(1_000);
        }
        throw new Error("等待图片生成完成超时（8 分钟，未检测到新的完整图片）");
    }
    async recoverCompletedGeneratedImages(outputDirectory, knownImageNumbers) {
        const page = await this.requirePage();
        const stopVisible = await this.stopButton(page)
            .isVisible()
            .catch(() => false);
        const messages = page.locator('[data-message-author-role="user"], [data-message-author-role="assistant"]');
        const count = await messages.count();
        const recovered = new Set(knownImageNumbers);
        let pendingImageNumber;
        for (let index = 0; index < count; index += 1) {
            const message = messages.nth(index);
            const role = await message.getAttribute("data-message-author-role");
            if (role === "user") {
                const text = await message.innerText().catch(() => "");
                const match = text.match(/请生成\s*Image\s*(10|[1-9])\b/i);
                pendingImageNumber = match ? Number(match[1]) : undefined;
                continue;
            }
            if (role !== "assistant" ||
                !pendingImageNumber ||
                recovered.has(pendingImageNumber)) {
                continue;
            }
            const images = message.locator('img[alt^="已生成图片"], img[alt^="Generated image"], img[alt^="Image generated"]');
            const imageCount = await images.count();
            if (imageCount === 0)
                continue;
            if (stopVisible && index === count - 1)
                continue;
            const outputPath = path.join(outputDirectory, `Image_${String(pendingImageNumber).padStart(2, "0")}.png`);
            await this.saveGeneratedImage(images.nth(imageCount - 1), outputPath);
            recovered.add(pendingImageNumber);
            pendingImageNumber = undefined;
        }
        // New ChatGPT image replies can live outside assistant message nodes.
        // This workflow emits exactly one image per numbered command, so global
        // image order is the stable fallback for reconciling missed downloads.
        const generatedImages = this.generatedImages(page);
        const generatedImageCount = Math.min(await generatedImages.count(), 10);
        for (let index = 0; index < generatedImageCount; index += 1) {
            const imageNumber = index + 1;
            if (recovered.has(imageNumber))
                continue;
            const outputPath = path.join(outputDirectory, `Image_${String(imageNumber).padStart(2, "0")}.png`);
            await this.saveGeneratedImage(generatedImages.nth(index), outputPath);
            recovered.add(imageNumber);
        }
        return [...recovered].sort((a, b) => a - b);
    }
    async generatedImageCount() {
        const page = await this.requirePage();
        return this.generatedImages(page).count();
    }
    async saveLatestCompletedGeneratedImage(outputPath, previousGeneratedImageCount = 0) {
        const page = await this.requirePage();
        const stopVisible = await this.stopButton(page)
            .isVisible()
            .catch(() => false);
        const images = this.generatedImages(page);
        const count = await images.count();
        if (stopVisible || count <= previousGeneratedImageCount) {
            return false;
        }
        await this.saveGeneratedImage(images.nth(count - 1), outputPath);
        return true;
    }
    async sendPromptOnce(prompt, fingerprint) {
        const page = await this.requirePage();
        const assistantCount = await this.assistantMessages(page).count();
        const userMessages = page.locator('[data-message-author-role="user"]');
        const userCount = await userMessages.count();
        const composer = this.composer(page);
        await composer.fill(prompt);
        const sendButton = this.sendButton(page);
        await sendButton.waitFor({ state: "visible", timeout: 15_000 });
        await sendButton.click();
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            const nextUserCount = await userMessages.count();
            const nextAssistantCount = await this.assistantMessages(page).count();
            const stopVisible = await this.stopButton(page)
                .isVisible()
                .catch(() => false);
            const latestUserMatches = nextUserCount > userCount &&
                (await userMessages
                    .nth(nextUserCount - 1)
                    .innerText()
                    .then((text) => text.includes(fingerprint))
                    .catch(() => false));
            if (nextUserCount > userCount ||
                nextAssistantCount > assistantCount ||
                stopVisible ||
                latestUserMatches) {
                return assistantCount;
            }
            await page.waitForTimeout(500);
        }
        throw new Error("无法确认 Prompt 是否发送成功。流程已停止，请检查 ChatGPT 页面后点击继续；程序不会自动重复发送。");
    }
    async recoverCompletedResponse(fingerprint) {
        const page = await this.requirePage();
        const stopVisible = await this.stopButton(page)
            .isVisible()
            .catch(() => false);
        if (stopVisible)
            return undefined;
        const messages = page.locator('[data-message-author-role="user"], [data-message-author-role="assistant"]');
        const sequence = await this.messageSequence(messages);
        for (let index = sequence.length - 1; index >= 0; index -= 1) {
            const message = sequence[index];
            if (message.role !== "user" || !message.text.includes(fingerprint)) {
                continue;
            }
            return this.assistantResponseAfter(sequence, index);
        }
        return undefined;
    }
    async hasUserPrompt(fingerprint) {
        const page = await this.requirePage();
        const users = page.locator('[data-message-author-role="user"]');
        const count = await users.count();
        for (let index = count - 1; index >= 0; index -= 1) {
            const text = await users.nth(index).innerText().catch(() => "");
            if (text.includes(fingerprint))
                return true;
        }
        return false;
    }
    async waitForResponseAfterPrompt(fingerprint) {
        const page = await this.requirePage();
        const startedAt = Date.now();
        let stableText = "";
        let stableSince;
        while (Date.now() - startedAt < RESPONSE_WAIT_MS) {
            const stopVisible = await this.stopButton(page)
                .isVisible()
                .catch(() => false);
            const messages = page.locator('[data-message-author-role="user"], [data-message-author-role="assistant"]');
            const sequence = await this.messageSequence(messages);
            let responseText = "";
            for (let index = sequence.length - 1; index >= 0; index -= 1) {
                const message = sequence[index];
                if (message.role !== "user" || !message.text.includes(fingerprint)) {
                    continue;
                }
                responseText = this.assistantResponseAfter(sequence, index) ?? "";
                break;
            }
            if (responseText && !stopVisible) {
                if (responseText !== stableText) {
                    stableText = responseText;
                    stableSince = Date.now();
                }
                else if (stableSince && Date.now() - stableSince >= 3_000) {
                    return responseText;
                }
            }
            else {
                stableSince = undefined;
            }
            await page.waitForTimeout(1_000);
        }
        throw new Error(`等待已发送 Prompt 的回复超时：${fingerprint}`);
    }
    async waitForResponse(previousAssistantCount) {
        const page = await this.requirePage();
        const startedAt = Date.now();
        let stableSince;
        let generationObserved = false;
        while (Date.now() - startedAt < RESPONSE_WAIT_MS) {
            const assistantCount = await this.assistantMessages(page).count();
            const stopVisible = await this.stopButton(page)
                .isVisible()
                .catch(() => false);
            if (stopVisible || assistantCount > previousAssistantCount) {
                generationObserved = true;
            }
            if (generationObserved && assistantCount > previousAssistantCount && !stopVisible) {
                stableSince ??= Date.now();
                if (Date.now() - stableSince >= 3_000) {
                    const latest = this.assistantMessages(page).last();
                    const text = (await latest.innerText()).trim();
                    if (text)
                        return text;
                }
            }
            else {
                stableSince = undefined;
            }
            await page.waitForTimeout(1_000);
        }
        throw new Error("等待 ChatGPT 回复超时（10 分钟）");
    }
    currentUrl() {
        return this.page && !this.page.isClosed() ? this.page.url() : undefined;
    }
    async requirePage() {
        if (!this.page || this.page.isClosed()) {
            throw new Error("专用 Chrome 尚未启动，请先点击“启动 Chrome”");
        }
        return this.page;
    }
    async connectToChrome() {
        this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);
        this.context = this.browser.contexts()[0];
        if (!this.context) {
            throw new Error("Chrome 调试连接没有可用浏览器上下文");
        }
        return this.context;
    }
    startNormalChrome() {
        const child = spawn(CHROME_PATH, [
            `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
            `--user-data-dir=${CHROME_PROFILE_DIR}`,
            "--no-first-run",
            "--no-default-browser-check",
            "--start-maximized",
            CHATGPT_URL
        ], {
            detached: true,
            stdio: "ignore"
        });
        child.unref();
    }
    async waitForChromeDebugPort() {
        const deadline = Date.now() + CHROME_START_WAIT_MS;
        while (Date.now() < deadline) {
            const ready = await fetch(`http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`)
                .then((response) => response.ok)
                .catch(() => false);
            if (ready)
                return;
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw new Error("普通 Chrome 启动超时，请检查是否被系统阻止");
    }
    composer(page) {
        return page
            .locator('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]')
            .first();
    }
    sendButton(page) {
        return page
            .locator('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="发送提示"]')
            .first();
    }
    stopButton(page) {
        return page
            .locator('button[data-testid="stop-button"], button[aria-label*="Stop generating"], button[aria-label*="停止生成"]')
            .first();
    }
    assistantMessages(page) {
        return page.locator('[data-message-author-role="assistant"]');
    }
    async messageSequence(messages) {
        return messages.evaluateAll((elements) => elements.map((element) => ({
            role: element.getAttribute("data-message-author-role"),
            text: element.innerText.trim()
        })));
    }
    assistantResponseAfter(sequence, userIndex) {
        const texts = sequence
            .slice(userIndex + 1)
            .filter((candidate) => candidate.role === "assistant" && candidate.text)
            .map((candidate) => candidate.text);
        return texts.length ? texts.join("\n\n").trim() : undefined;
    }
    generatedImages(page) {
        return page.locator('img[alt^="已生成图片"], img[alt^="Generated image"], img[alt^="Image generated"]');
    }
    async saveGeneratedImage(image, outputPath) {
        const metadata = await image.evaluate((element) => {
            const generatedImage = element;
            return {
                src: generatedImage.currentSrc || generatedImage.src,
                width: generatedImage.naturalWidth,
                height: generatedImage.naturalHeight
            };
        });
        if (!metadata.src || metadata.width < 300 || metadata.height < 300) {
            throw new Error("已检测到生成图片，但无法读取高清图片资源");
        }
        const page = await this.requirePage();
        const imageData = await page.evaluate(async (src) => {
            const response = await fetch(src, { credentials: "include" });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            let binary = "";
            for (let offset = 0; offset < bytes.length; offset += 32_768) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
            }
            return btoa(binary);
        }, metadata.src);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, Buffer.from(imageData, "base64"));
    }
    async clickAttachmentButton(page) {
        const buttons = [
            'button[aria-label*="Attach"]',
            'button[aria-label*="Upload"]',
            'button[aria-label*="添加"]',
            'button[aria-label*="上传"]',
            'button[data-testid*="composer-plus"]'
        ];
        for (const selector of buttons) {
            const button = page.locator(selector).first();
            if (await button.isVisible().catch(() => false)) {
                await button.click();
                return;
            }
        }
        throw new Error("找不到 ChatGPT 图片上传按钮");
    }
    async waitForAttachmentCount(page, expected) {
        const deadline = Date.now() + UPLOAD_WAIT_MS;
        while (Date.now() < deadline) {
            const counts = await Promise.all([
                page.locator('[data-testid*="attachment"]').count(),
                page.locator('button[aria-label*="Remove file"]').count(),
                page.locator('button[aria-label*="移除文件"]').count(),
                page.locator('#prompt-textarea').locator("xpath=..").locator("img").count()
            ]);
            if (Math.max(...counts) >= expected)
                return;
            await page.waitForTimeout(1_000);
        }
        throw new Error(`图片上传未完成：未检测到 ${expected} 个附件缩略图`);
    }
}
//# sourceMappingURL=chatgpt-adapter.js.map