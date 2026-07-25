import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { CHATGPT_URL, CHROME_DEBUG_PORT, CHROME_PATH, CHROME_PROFILE_DIR } from "./config.js";
import { compressGeneratedImage } from "./image-compress.js";
const LOGIN_WAIT_MS = 15_000;
const CHROME_START_WAIT_MS = 30_000;
const UPLOAD_WAIT_MS = 90_000;
const RESPONSE_WAIT_MS = 22 * 60_000;
// ① 生成停滞检测：stop 仍可见且回复文本连续此分钟数零增长 → 判定停滞并自动重发
const STALL_DETECT_MS = 3 * 60_000;
const MAX_STALL_RETRIES = 2;
// ② 周期性页面健康检查：每此毫秒复查是否掉登录 / 人机验证 / 报错弹窗
const HEALTH_CHECK_MS = 90 * 1000;
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
        let page = await this.requirePage();
        let ready = await this.composer(page)
            .waitFor({ state: "visible", timeout: LOGIN_WAIT_MS })
            .then(() => true)
            .catch(() => false);
        if (!ready) {
            // 适配器可能持有了一个旧的/未登录的页面引用；尝试在所有上下文/标签中找可用的 ChatGPT 页
            const readyPage = await this.findReadyPage();
            if (readyPage) {
                this.page = readyPage;
                this.context = readyPage.context();
                page = readyPage;
                ready = true;
            }
        }
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
    async findReadyPage() {
        if (!this.browser || !this.browser.isConnected()) {
            return undefined;
        }
        for (const context of this.browser.contexts()) {
            for (const page of context.pages()) {
                if (page.isClosed() || !page.url().includes("chatgpt.com")) {
                    continue;
                }
                try {
                    await this.composer(page).waitFor({ state: "visible", timeout: 3_000 });
                    return page;
                } catch {
                    // 继续试下一个页面
                }
            }
        }
        return undefined;
    }
    async createBlankChat() {
        // 创建新对话需要重新导航到首页，不跳过已有 URL
        return this.navigateWithRetry(CHATGPT_URL, () => false);
    }
    async openChat(chatUrl) {
        await this.launch();
        if (!chatUrl.startsWith("https://chatgpt.com/c/")) {
            throw new Error("没有可继续的商品对话 URL，请先完成 MVP 1");
        }
        return this.navigateWithRetry(chatUrl, (url) => url === chatUrl);
    }
    isTransientNavigationError(error) {
        const message = error instanceof Error ? error.message : String(error);
        return /frame was detached|target closed|execution context was destroyed|navigating|page closed|browser is not connected/i.test(message);
    }
    async navigateWithRetry(targetUrl, urlMatches) {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                let page = await this.requirePage();
                if (!urlMatches(page.url())) {
                    await page.goto(targetUrl, {
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
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`[chatgpt] navigateWithRetry 第 ${attempt}/${maxAttempts} 次失败：${message}`);
                if (attempt >= maxAttempts || !this.isTransientNavigationError(error)) {
                    throw error;
                }
                // 页面/上下文可能已损坏，重置并重新连接
                this.page = undefined;
                this.context = undefined;
                if (!this.browser?.isConnected()) {
                    this.browser = undefined;
                }
                await this.launch();
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        }
        throw new Error(`navigateWithRetry 多次重试后仍无法导航到 ${targetUrl}`);
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
        try {
            await this.selectComposerTool("创建图片", [
                "描述图片",
                "描述或编辑图片",
                "Describe an image",
                "Create an image",
                "Create image",
                "DALL-E"
            ], [
                "创建图片",
                "DALL-E",
                "Image",
                "Create image",
                "Describe an image"
            ]);
        }
        catch (error) {
            console.warn(`[chatgpt] 创建图片工具未显式确认启用（${error?.message || error}）。当前 ChatGPT UI 可能已自动处于可生成图像模式，将继续发送作图 prompt。`);
        }
    }
    async selectComposerTool(toolName, expectedPlaceholders, toolAliases = []) {
        const page = await this.requirePage();
        const url = page.url();
        // 前置检查：如果目标工具已经启用（placeholder 可见 或 已选 chip 可见），直接跳过
        const allPlaceholderSelectors = expectedPlaceholders
            .flatMap((placeholder) => [
                `#prompt-textarea [data-placeholder="${placeholder}"]`,
                `textarea[data-testid="prompt-textarea"][data-placeholder="${placeholder}"]`,
                `[contenteditable="true"][data-placeholder="${placeholder}"]`,
                `[contenteditable="true"] [data-placeholder="${placeholder}"]`
            ])
            .join(", ");
        const alreadyEnabledByPlaceholder = await page.locator(allPlaceholderSelectors)
            .first()
            .isVisible()
            .catch(() => false);
        if (alreadyEnabledByPlaceholder) {
            console.log(`[chatgpt] ${toolName} 已处于启用状态（placeholder 匹配），跳过工具选择`);
            return;
        }
        const exactName = new RegExp(`^\\s*${escapeRegex(toolName)}\\s*$`, "i");
        const toolChip = page
            .locator('button, [role="button"], [aria-label], [data-testid*="tool"], [data-testid*="composer"]')
            .filter({ hasText: exactName })
            .first();
        const alreadyEnabledByChip = await toolChip
            .isVisible()
            .catch(() => false);
        if (alreadyEnabledByChip) {
            console.log(`[chatgpt] ${toolName} 已处于启用状态（chip 匹配），跳过工具选择`);
            return;
        }
        const plusButton = page
            .locator('button[data-testid="composer-plus-btn"], button[aria-label*="Attach"], button[aria-label*="Upload"], button[aria-label*="工具"], button[aria-label*="Tools"], button[aria-label*="添加"]')
            .first();
        await plusButton.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {
            throw new Error(`找不到 ChatGPT  composer plus 按钮，无法打开工具菜单（URL: ${url}）`);
        });
        let toolOption;
        const namesToTry = [toolName, ...toolAliases];
        for (let attempt = 0; attempt < 4; attempt += 1) {
            // 先尝试在不打开菜单的情况下定位（菜单可能已展开）
            for (const name of namesToTry) {
                toolOption = await this.findComposerToolOption(page, name, attempt === 0 ? 400 : 1_000);
                if (toolOption)
                    break;
            }
            if (toolOption)
                break;
            // 点击 plus 按钮展开菜单；已展开时再次点击通常无害，但 prefer 只在第一次/不可见时点击
            const menuOpen = await page.locator('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper"], [data-testid*="popover"], [data-testid*="dropdown"], [data-testid*="tool-menu"]')
                .first()
                .isVisible()
                .catch(() => false);
            if (!menuOpen || attempt === 0) {
                await plusButton.click().catch((error) => {
                    console.warn(`[chatgpt] 打开工具菜单点击失败（第 ${attempt + 1} 次）：${error?.message || error}`);
                });
            }
            await page.waitForTimeout(300 + attempt * 200);
        }
        if (!toolOption) {
            const menuText = await page.locator('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper"], [data-testid*="popover"], [data-testid*="dropdown"], [data-testid*="tool-menu"]')
                .first()
                .innerText({ timeout: 2_000 })
                .catch(() => "");
            throw new Error(`找不到 ChatGPT 工具菜单项“${toolName}”。当前菜单内容：${menuText || "未读取到菜单内容"} | URL: ${url}`);
        }
        const checked = (await toolOption.getAttribute("aria-checked").catch(() => null)) ??
            (await toolOption.getAttribute("aria-pressed").catch(() => null));
        if (checked === "true") {
            // 菜单本身已声明该工具处于激活态，直接信任并关闭菜单，避免依赖不稳定的 placeholder/chip 检测
            await page.keyboard.press("Escape");
            console.log(`[chatgpt] ${toolName} 菜单项 aria-checked=true，确认已启用`);
            return;
        }
        await toolOption.click();
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
        const chipVisible = await toolChip
            .waitFor({ state: "visible", timeout: 2_000 })
            .then(() => true)
            .catch(() => false);
        if (!chipVisible) {
            throw new Error(`无法确认 ChatGPT“${toolName}”已启用（URL: ${url}）`);
        }
    }
    async findComposerToolOption(page, toolName, timeout = 1_500) {
        const exactName = new RegExp(`^\\s*${escapeRegex(toolName)}\\s*$`, "i");
        const containsName = new RegExp(escapeRegex(toolName), "i");
        const candidates = [
            page.getByRole("menuitemradio", { name: toolName, exact: true }),
            page.getByRole("menuitem", { name: toolName, exact: true }),
            page.getByRole("option", { name: toolName, exact: true }),
            page.getByRole("button", { name: toolName, exact: true }),
            page.getByText(toolName, { exact: true }),
            page.locator(`[data-testid*="tool"]:has-text("${toolName}")`).first(),
            page.locator(`[data-testid*="composer"]:has-text("${toolName}")`).first(),
            page.locator(`[role="menuitemradio"], [role="menuitem"], [role="option"], button, [role="button"], div, span`)
                .filter({ hasText: exactName })
                .first(),
            page.locator(`[role="menuitemradio"], [role="menuitem"], [role="option"], button, [role="button"], div, span, li`)
                .filter({ hasText: containsName })
                .first()
        ];
        for (const candidate of candidates) {
            try {
                const visible = await candidate
                    .waitFor({ state: "visible", timeout })
                    .then(() => true)
                    .catch(() => false);
                if (visible)
                    return candidate;
            }
            catch {
                // 某个候选选择器本身异常时继续尝试下一个
            }
        }
        return undefined;
    }
    async waitForGeneratedImageAndDownload(previousGeneratedImageCount, outputPath) {
        const page = await this.requirePage();
        const deadline = Date.now() + 8 * 60_000;
        let detectedAt;
        let lastHealthCheck = Date.now();
        while (Date.now() < deadline) {
            const alreadySaved = await access(outputPath)
                .then(() => true)
                .catch(() => false);
            if (alreadySaved)
                return;
            const stopVisible = await this.stopButton(page)
                .isVisible()
                .catch(() => false);
            // ② 周期性页面健康检查：图片生成阶段同样可能因掉登录 / 验证而永远等不到图
            if (Date.now() - lastHealthCheck > HEALTH_CHECK_MS) {
                lastHealthCheck = Date.now();
                const health = await this.quickHealthCheck().catch(() => ({ ok: true }));
                if (!health.ok) {
                    throw new Error(`ChatGPT 页面异常（${health.reason}${health.url ? " @ " + health.url : ""}），已停止等待图片生成。请检查登录/人机验证后点击「继续」。`);
                }
            }
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
            const outputPath = path.join(outputDirectory, `Image_${String(pendingImageNumber).padStart(2, "0")}.jpg`);
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
            const outputPath = path.join(outputDirectory, `Image_${String(imageNumber).padStart(2, "0")}.jpg`);
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
        // 记录最近一次发送的 prompt，供「生成停滞自动重发」(①) 复用
        this._lastPrompt = prompt;
        const assistantCount = await this.assistantMessages(page).count();
        const userMessages = page.locator('[data-message-author-role="user"]');
        const userCount = await userMessages.count();
        const composer = this.composer(page);
        // 健壮写入：先清空输入框可能残留的历史文本（即便输入框因残留内容被撑高/移出视口，
        // .fill() 会因无法滚入视口而 30s 超时并中断整条流程）。改用「聚焦→全选删除→insertText」
        // 不依赖元素是否在视口中央，可彻底避免该死循环。
        await page.evaluate(() => {
            const el = document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]');
            if (!el) return;
            el.focus();
            const sel = window.getSelection();
            if (!sel) return;
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
        }).catch(() => {});
        await page.keyboard.press("Delete").catch(() => {});
        await page.keyboard.press("Backspace").catch(() => {});
        // 兜底：仍有残留则直接清空 DOM 并触发 input 事件
        await page.evaluate(() => {
            const el = document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]');
            if (el && (el.textContent || "").length > 0) {
                el.innerHTML = "";
                el.dispatchEvent(new Event("input", { bubbles: true }));
            }
        }).catch(() => {});
        await page.keyboard.insertText(prompt);
        const sendButton = this.sendButton(page);
        await sendButton.waitFor({ state: "visible", timeout: 15_000 });
        await this.dismissOverlays(page);
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
        // 先确保 this.page 指向可用的 ChatGPT 页面
        if (this.page && !this.page.isClosed()) {
            const ready = await this.composer(this.page)
                .waitFor({ state: "visible", timeout: 3_000 })
                .then(() => true)
                .catch(() => false);
            if (!ready) {
                const readyPage = await this.findReadyPage();
                if (readyPage) {
                    this.page = readyPage;
                    this.context = readyPage.context();
                }
            }
        }
        const pages = [];
        if (this.page && !this.page.isClosed()) {
            pages.push(this.page);
        }
        if (this.browser && this.browser.isConnected()) {
            for (const context of this.browser.contexts()) {
                for (const page of context.pages()) {
                    if (!page.isClosed() && page.url().includes("chatgpt.com") && !pages.includes(page)) {
                        pages.push(page);
                    }
                }
            }
        }
        for (const page of pages) {
            try {
                const stopVisible = await this.stopButton(page)
                    .isVisible()
                    .catch(() => false);
                if (stopVisible)
                    continue;
                const messages = page.locator('[data-message-author-role="user"], [data-message-author-role="assistant"]');
                const sequence = await this.messageSequence(messages);
                for (let index = sequence.length - 1; index >= 0; index -= 1) {
                    const message = sequence[index];
                    if (message.role !== "user" || !message.text.includes(fingerprint)) {
                        continue;
                    }
                    return this.assistantResponseAfter(sequence, index);
                }
            } catch {
                // 尝试下一个页面
            }
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
        // ① 停滞探测状态
        let lastAssistantLen = 0;
        let lastGrowthAt = startedAt;
        let generationObserved = false;
        let stallRetries = 0;
        // ② 健康检查状态
        let lastHealthCheck = startedAt;
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
            if (responseText.length > 0)
                generationObserved = true;
            // ② 周期性页面健康检查：检测掉登录 / 人机验证 / 报错弹窗
            if (Date.now() - lastHealthCheck > HEALTH_CHECK_MS) {
                lastHealthCheck = Date.now();
                const health = await this.quickHealthCheck().catch(() => ({ ok: true }));
                if (!health.ok) {
                    await this.clickStopSafely(page);
                    throw new Error(`ChatGPT 页面异常（${health.reason}${health.url ? " @ " + health.url : ""}），已停止等待。请检查登录/人机验证后点击「继续」重新运行本阶段。`);
                }
            }
            // ① 生成停滞检测：stop 仍可见，但回复文本长时间零增长 → 自动点停止并重发
            if (stopVisible && generationObserved && Date.now() - lastGrowthAt > STALL_DETECT_MS) {
                stallRetries += 1;
                if (stallRetries > MAX_STALL_RETRIES || !this._lastPrompt) {
                    await this.clickStopSafely(page);
                    throw new Error(`ChatGPT 回复生成停滞（连续 ${(STALL_DETECT_MS / 60000) | 0} 分钟无新内容），已重试 ${MAX_STALL_RETRIES} 次仍无进展，本阶段失败：${fingerprint}`);
                }
                console.warn(`[chatgpt] 检测到生成停滞，自动点停止并重发（第 ${stallRetries} 次）：${fingerprint}`);
                await this.clickStopSafely(page);
                await page.waitForTimeout(2_000);
                try {
                    await this.sendPromptOnce(this._lastPrompt, fingerprint);
                }
                catch (resendError) {
                    throw new Error(`ChatGPT 生成停滞且重发失败：${fingerprint}（${resendError?.message || resendError}）`);
                }
                // 重置停滞跟踪，进入新一轮等待
                lastAssistantLen = 0;
                lastGrowthAt = Date.now();
                generationObserved = false;
                stableText = "";
                stableSince = undefined;
                await page.waitForTimeout(1_000);
                continue;
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
            // 记录回复文本增长，用于停滞探测（仅 stop 可见（生成中）时累计）
            if (stopVisible && responseText.length > lastAssistantLen) {
                lastAssistantLen = responseText.length;
                lastGrowthAt = Date.now();
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
    async dismissOverlays(page) {
        const dialog = page
            .locator('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="dialog"][aria-modal="true"]')
            .first();
        if (!(await dialog.isVisible().catch(() => false)))
            return;
        console.log("[chatgpt] 检测到模态弹窗，尝试关闭");
        const closeBtn = dialog
            .locator('button[aria-label="Close"], button[aria-label="关闭"], [data-testid="close-button"], button:has-text("关闭"), button:has-text("Close")')
            .first();
        if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click().catch(() => {});
        }
        else {
            await page.keyboard.press("Escape").catch(() => {});
        }
        await page.waitForTimeout(400);
        if (await dialog.isVisible().catch(() => false)) {
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(400);
        }
    }
    stopButton(page) {
        return page
            .locator('button[data-testid="stop-button"], button[aria-label*="Stop generating"], button[aria-label*="停止生成"]')
            .first();
    }
    assistantMessages(page) {
        return page.locator('[data-message-author-role="assistant"]');
    }
    // 安全地点 stop 按钮：不可点（已结束/不存在）时静默忽略
    async clickStopSafely(page) {
        try {
            const stop = this.stopButton(page);
            if (await stop.isVisible().catch(() => false)) {
                await stop.click({ timeout: 5_000 });
                await page.waitForTimeout(500);
            }
        }
        catch {
            // 忽略：stop 不可点也无妨，等待循环会继续
        }
    }
    // ② 轻量页面健康检查：检测掉登录跳转 / 人机验证 / 常见报错弹窗（不阻塞正常生成）
    async quickHealthCheck() {
        const page = await this.requirePage();
        const url = page.url();
        if (!/chatgpt\.com/i.test(url)) {
            return { ok: false, reason: "页面已跳转（可能掉登录）", url };
        }
        const text = await page
            .locator("body")
            .innerText({ timeout: 4_000 })
            .catch(() => "");
        if (/verify you are human|真人验证|验证您是真人|checking your browser|执行安全验证/i.test(text)) {
            return { ok: false, reason: "人机验证", url };
        }
        if (/something went wrong|please try again|您已达到|rate limit|try again later|an error occurred|请求过于频繁|暂时无法使用/i.test(text)) {
            return { ok: false, reason: "报错弹窗", url };
        }
        return { ok: true };
    }
    async messageSequence(messages) {
        const deadline = Date.now() + 10_000;
        let lastError;
        while (Date.now() < deadline) {
            try {
                return await messages.evaluateAll((elements) => elements.map((element) => ({
                    role: element.getAttribute("data-message-author-role"),
                    text: element.innerText.trim()
                })));
            }
            catch (error) {
                lastError = error;
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes("Execution context was destroyed") ||
                    message.includes("Frame was detached") ||
                    message.includes("Target closed") ||
                    message.includes("Navigating")) {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    continue;
                }
                throw error;
            }
        }
        throw lastError ?? new Error("无法读取 ChatGPT 消息序列");
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
        // 自动压缩：生产完图片保存本地时压到 ≤200KB（仅压缩体积，不改尺寸/内容；用户选择 jpg，透明背景填白）
        await compressGeneratedImage(outputPath, 200).catch((e) => {
            console.warn("[compress] 图片压缩跳过，保留原图：", e?.message || e);
        });
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