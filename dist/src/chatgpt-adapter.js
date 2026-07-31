import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { CHATGPT_URL, CHATGPT_MODEL, CHATGPT_REASONING, CHROME_DEBUG_PORT, CHROME_PATH, CHROME_PROFILE_DIR } from "./config.js";
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
    // 确保 ChatGPT 当前对话使用指定模型 + 推理档位（非致命，UI 变动时仅告警）
    // 同一对话（URL 不变）只对齐一次，避免每次发送都反复开菜单
    async ensureChatGptModelAndReasoning(page) {
        const modelTarget = (CHATGPT_MODEL || "GPT-5.6 Sol").toString().trim();
        const reasonTarget = (CHATGPT_REASONING || "中").toString().trim(); // 低 / 中 / 高
        try {
            const url = page.url();
            // 用对话 ID（URL path 末段 /c/<uuid> 或 temporary-chat）判重，而非完整 URL：
            // ChatGPT 对话 URL 常带变化的 query/hash，用完整 URL 判重会失效 → 每次发送都重弹模型菜单（左面板跳动）。
            const convId = (url.match(/\/c\/([a-z0-9-]+)/i) || [])[1]
                || (/\/temporary-chat/i.test(url) ? "temporary" : (url || "default"));
            if (this._ensuredModelConv === convId && this._ensuredModelOk) {
                return;
            }
            // 推理档位/模型的触发器：composer 里 class 含 __composer-pill 的可点击元素
            const pillInfo = await page.evaluate(() => {
                const pills = Array.from(document.querySelectorAll('button, [role="button"]'));
                for (const p of pills) {
                    const cls = (p.className || "").toString();
                    if (!cls.includes("__composer-pill"))
                        continue;
                    const t = (p.textContent || "").trim();
                    if (["低", "中", "高"].includes(t) || /gpt|智能极速|auto/i.test(t)) {
                        return { text: t, hasPopup: p.getAttribute("aria-haspopup") || "" };
                    }
                }
                return null;
            });
            if (!pillInfo) {
                console.warn("[chatgpt] 未找到 composer 模型/推理 pill，跳过模型设置（不影响发送）");
                return;
            }
            const pill = page.locator('button.__composer-pill, [role="button"].__composer-pill').first();

            // 1) 推理档位：当前不是目标才改
            if (pillInfo.text !== reasonTarget) {
                await pill.click({ timeout: 5000 }).catch(() => {});
                await page.waitForTimeout(400);
                const clicked = await this._clickChatGptMenuItem(page, reasonTarget, ["menuitemradio", "menuitem"]);
                await page.keyboard.press("Escape").catch(() => {});
                await page.waitForTimeout(200);
                if (!clicked)
                    console.warn(`[chatgpt] 推理档位「${reasonTarget}」未找到，跳过`);
            }

            // 2) 模型：打开模型子菜单后选择目标模型（已选中则跳过）
            await pill.click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(400);
            const opened = await this._clickChatGptMenuItem(page, modelTarget, ["menuitem"], true);
            if (opened) {
                await page.waitForTimeout(500);
                const selected = await this._selectChatGptModelInSubmenu(page, modelTarget);
                if (!selected)
                    console.warn(`[chatgpt] 模型「${modelTarget}」未在子菜单选中`);
            }
            else {
                console.warn(`[chatgpt] 未找到模型子菜单项「${modelTarget}」`);
            }
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(200);

            this._ensuredModelConv = convId;
            this._ensuredModelOk = true;
            console.log(`[chatgpt] 已对齐模型=${modelTarget} 推理=${reasonTarget}（对话 ${convId}）`);
        }
        catch (e) {
            console.warn("[chatgpt] 设置模型/推理档位失败（非致命，继续发送）：", e?.message || e);
        }
    }

    // 在已打开的菜单里点击文本匹配的项；requirePopup=true 仅点 aria-haspopup=menu 的子菜单入口
    async _clickChatGptMenuItem(page, text, roles, requirePopup = false) {
        const handle = await page.evaluateHandle(({ text, roles, requirePopup }) => {
            const sel = roles.map((r) => `[role="${r}"]`).join(",");
            const items = Array.from(document.querySelectorAll(sel));
            for (const it of items) {
                const t = (it.textContent || "").trim();
                if (t === text || t.includes(text)) {
                    if (requirePopup && (it.getAttribute("aria-haspopup") || "") !== "menu")
                        continue;
                    return it;
                }
            }
            return null;
        }, { text, roles, requirePopup });
        const el = handle.asElement();
        if (!el)
            return false;
        await el.click({ timeout: 5000 }).catch(() => {});
        return true;
    }

    // 在模型子菜单里选择目标模型；已 aria-checked=true 视为已选，返回 true
    async _selectChatGptModelInSubmenu(page, modelTarget) {
        const handle = await page.evaluateHandle(({ text }) => {
            const items = Array.from(document.querySelectorAll('[role="menuitemradio"],[role="menuitem"],[role="option"]'));
            for (const it of items) {
                const t = (it.textContent || "").trim();
                if (t.includes(text)) {
                    if (it.getAttribute("aria-checked") === "true")
                        return null;
                    return it;
                }
            }
            return null;
        }, { text: modelTarget });
        const el = handle.asElement();
        if (!el)
            return true; // 没找到未选中的 = 已是目标（视为成功）
        await el.click({ timeout: 5000 }).catch(() => {});
        return true;
    }

    async sendPromptOnce(prompt, fingerprint) {
        const page = await this.requirePage();
        // 发送前自动对齐 ChatGPT 模型 + 推理档位（非致命：UI 变动时仅告警不阻断流程）
        await this.ensureChatGptModelAndReasoning(page);
        // 发送前先做健康检查：掉登录 / 人机验证 / 报错弹窗都会让 send 静默失败
        const preHealth = await this.quickHealthCheck().catch(() => ({ ok: true }));
        if (!preHealth.ok) {
            throw new Error(`ChatGPT 页面异常（${preHealth.reason}${preHealth.url ? " @ " + preHealth.url : ""}），未发送 Prompt。请检查登录/人机验证后点「重试失败项」。`);
        }
        // 记录最近一次发送的 prompt，供「生成停滞自动重发」(①) 复用
        this._lastPrompt = prompt;

        const attemptOnce = async () => {
            const assistantCount = await this.assistantMessages(page).count();
            const userMessages = page.locator('[data-message-author-role="user"]');
            const userCount = await userMessages.count();
            // 健壮写入：先清空输入框可能残留的历史文本
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
            await page.evaluate(() => {
                const el = document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]');
                if (el && (el.textContent || "").length > 0) {
                    el.innerHTML = "";
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                }
            }).catch(() => {});
            await page.keyboard.insertText(prompt);
            // 先等 send 态就绪（处理上一行仍在生成的 stop 态），再用 waitFor 兜底可见性
            await this.waitForSendReady(page, 60_000);
            const sendButton = this.sendButton(page);
            await sendButton.waitFor({ state: "visible", timeout: 5_000 });
            await this.dismissOverlays(page);
            await sendButton.click();
            // 延长到 45s（30s 太短，长 Prompt 经常误判）
            const deadline = Date.now() + 45_000;
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
            throw new Error("timeout");
        };

        // 最多尝试 2 次：第 1 次失败先 dismissOverlays + 健康检查，再试 1 次
        try {
            return await attemptOnce();
        }
        catch (error) {
            if (error.message !== "timeout") {
                throw error;
            }
            // 重试前清理：弹窗 + 健康检查 + 再次清空 composer
            await this.dismissOverlays(page).catch(() => {});
            const retryHealth = await this.quickHealthCheck().catch(() => ({ ok: true }));
            if (!retryHealth.ok) {
                throw new Error(`ChatGPT 页面异常（${retryHealth.reason}${retryHealth.url ? " @ " + retryHealth.url : ""}），重试未执行。请检查后点「重试失败项」。`);
            }
            try {
                return await attemptOnce();
            }
            catch (retryError) {
                if (retryError.message !== "timeout") {
                    throw retryError;
                }
                throw new Error("无法确认 Prompt 是否发送成功（已自动重试 1 次仍超时）。请检查 ChatGPT 页面后，在批量制作页点「↻ 重试失败项」；单品流程在工作台点「继续」即可。");
            }
        }
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
        // 生成中心跳状态：供 /api/status 实时回报「ChatGPT 正在生成」（前台据此显示已等待秒数，消除「要刷新才更新」的错觉）
        this._waiting = { fingerprint, startedAt, lastTickAt: startedAt };
        let stableText = "";
        let stableSince;
        // ① 停滞探测状态
        let lastAssistantLen = 0;
        let lastGrowthAt = startedAt;
        let generationObserved = false;
        let stallRetries = 0;
        // ② 健康检查状态
        let lastHealthCheck = startedAt;
        let lastResponseText = "";
        let lastTextCheck = 0;
        const TEXT_POLL_MS = 25_000;
        while (Date.now() - startedAt < RESPONSE_WAIT_MS) {
            if (this._waiting) this._waiting.lastTickAt = Date.now();
            const stopVisible = await this.stopButton(page)
                .isVisible()
                .catch(() => false);
            // 性能优化：生成中（stop 可见）时降低文本读取频率（每 TEXT_POLL_MS 仅一次），
            // 避免长对话每 2s 全量序列化文本导致主线程持续繁忙、ChatGPT 左侧栏抖动/页面卡死。
            // 仅当生成疑似结束（stop 不可见）或到点时才读取一次消息文本。
            let responseText = "";
            if (!stopVisible || Date.now() - lastTextCheck > TEXT_POLL_MS) {
                lastTextCheck = Date.now();
                const messages = page.locator('[data-message-author-role="user"], [data-message-author-role="assistant"]');
                const sequence = await this.messageSequence(messages);
                for (let index = sequence.length - 1; index >= 0; index -= 1) {
                    const message = sequence[index];
                    if (message.role !== "user" || !message.text.includes(fingerprint)) {
                        continue;
                    }
                    responseText = this.assistantResponseAfter(sequence, index) ?? "";
                    break;
                }
            }
            else {
                responseText = lastResponseText;
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
                    this._waiting = null;
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
            // 轮询从 1s 放宽到 2s：配合 messageSequence 轻量化 + 生成中跳文本读取，减少主线程占用，
            // 既能实时感知回复完成（秒级），又显著降低 ChatGPT 页面卡顿。
            lastResponseText = responseText;
            await page.waitForTimeout(2_000);
        }
        this._waiting = null;
        throw new Error(`等待已发送 Prompt 的回复超时：${fingerprint}`);
    }
    getWaitingState() {
        if (!this._waiting) return null;
        return {
            active: true,
            fingerprint: this._waiting.fingerprint,
            startedAt: this._waiting.startedAt,
            lastTickAt: this._waiting.lastTickAt,
            elapsedMs: Date.now() - this._waiting.startedAt
        };
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
            await page.waitForTimeout(2_000);
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
            // 性能优化：降低 GPU/后台网络/扩展对主线程的争抢，缓解长对话卡顿
            "--disable-gpu",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-features=Translate,BackForwardCache,OptimizationHints",
            "--disable-background-timer-throttling",
            "--no-sandbox",
            "--disable-dev-shm-usage",
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
        // composer-submit-button 是 ChatGPT 的固定 id；aria-label/data-testid 在 send↔stop 之间切换
        // 严格只匹配 send 态：data-testid="send-button" + aria-label 中含"发送/Send"
        return page
            .locator('button#composer-submit-button[data-testid="send-button"], button[aria-label="发送提示"][data-testid="send-button"], button[aria-label="Send prompt"][data-testid="send-button"]')
            .first();
    }
    // 兼容旧的 send-button 选择器（仅用于错误信息回显，避免误中 stop-button）
    _sendButtonStrict(page) {
        return page
            .locator('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="发送提示"]')
            .first();
    }
    // 等 send 按钮从「stop 态」切回「send 态」。批量跑时前一行可能仍在生成，
    // 此时 send-button 永远不存在（被 stop-button 替换），必须先等 stop 消失。
    async waitForSendReady(page, timeoutMs = 60_000) {
        const stop = this.stopButton(page);
        const send = this._sendButtonStrict(page);
        const deadline = Date.now() + timeoutMs;
        let lastDiag = "";
        while (Date.now() < deadline) {
            const stopVisible = await stop.isVisible().catch(() => false);
            const sendVisible = await send.isVisible().catch(() => false);
            if (sendVisible && !stopVisible) return; // 可发
            // stop 还在 → 抓诊断
            if (stopVisible) {
                lastDiag = `stop-button 仍可见（ChatGPT 仍在生成中），已等待 ${Math.round((timeoutMs - (deadline - Date.now())) / 1000)}s`;
                await page.waitForTimeout(800);
                continue;
            }
            // send 不可见、stop 也不可见 → 可能页面掉登录/未进入对话
            lastDiag = "send-button 不可见且 stop-button 也不可见（页面可能不在对话状态）";
            await page.waitForTimeout(800);
        }
        // 超时：抛明确错误，包含最后状态
        const url = page.url().slice(0, 120);
        const stopStillVisible = await stop.isVisible().catch(() => false);
        throw new Error(`等不到可发送状态：${lastDiag || "未知原因"} @ ${url}（stop 仍可见=${stopStillVisible}）。批量模式下前一行 ChatGPT 还没生成完，请重试或在 ChatGPT 页面手动停止后重发。`);
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
    // 注意：禁止对整页 body 做 innerText 序列化——长作图会话 DOM 极重，全量读取会触发页面卡死。
    // 改为只查 URL + 在小范围 alert/toast 容器上做针对性检测。
    async quickHealthCheck() {
        const page = await this.requirePage();
        const url = page.url();
        if (!/chatgpt\.com/i.test(url)) {
            return { ok: false, reason: "页面已跳转（可能掉登录）", url };
        }
        const alertSel = [
            '[role="alert"]',
            '[data-testid*="toast"]',
            '[data-testid*="error"]',
            '[data-testid="error-boundary"]',
            'iframe[src*="captcha"]',
            'iframe[src*="challenge"]',
            'iframe[src*="turnstile"]'
        ].join(", ");
        const alertCount = await page.locator(alertSel).count().catch(() => 0);
        if (alertCount > 0) {
            const text = await page
                .locator(alertSel)
                .first()
                .innerText({ timeout: 2_000 })
                .catch(() => "");
            if (/verify you are human|真人验证|验证您是真人|checking your browser|执行安全验证/i.test(text)) {
                return { ok: false, reason: "人机验证", url };
            }
            if (/something went wrong|please try again|您已达到|rate limit|try again later|an error occurred|请求过于频繁|暂时无法使用/i.test(text)) {
                return { ok: false, reason: "报错弹窗", url };
            }
        }
        return { ok: true };
    }
    async messageSequence(messages) {
        const deadline = Date.now() + 10_000;
        let lastError;
        while (Date.now() < deadline) {
            try {
                return await messages.evaluateAll((elements) => {
                    // 只处理最后 20 条消息即可：fingerprint 匹配与最新回复都在最近区域，
                    // 跳过早期长历史可少序列化几十 KB 文本。
                    // 用 textContent 替代 innerText：避免强制同步布局（长对话重排极慢），提速明显。
                    const els = elements.slice(-20);
                    return els.map((element) => ({
                        role: element.getAttribute("data-message-author-role"),
                        text: (element.textContent || "").trim()
                    }));
                });
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