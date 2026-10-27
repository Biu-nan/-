import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { CHATGPT_URL, CHATGPT_MODEL, CHATGPT_REASONING, CHATGPT_MODEL_CHAIN, CHATGPT_MODEL_STRICT, CHROME_DEBUG_PORT, CHROME_PATH, CHROME_PROFILE_DIR } from "./config.js";
import { compressGeneratedImage } from "./image-compress.js";
const LOGIN_WAIT_MS = 15_000;
const CHROME_START_WAIT_MS = 30_000;
const UPLOAD_WAIT_MS = 90_000;
const RESPONSE_WAIT_MS = 22 * 60_000;
// ChatGPT 有时会直接结束「思考」而不生成 assistant 消息。此时 Stop 按钮已消失，
// 不能再依赖「生成中」停滞检测；给页面一个短暂渲染宽限后必须交给工作流恢复。
const STOPPED_WITHOUT_OUTPUT_GRACE_MS = 15_000;
// ① 生成停滞检测：stop 仍可见且回复文本连续此分钟数零增长 → 判定停滞并自动重发
const STALL_DETECT_MS = 3 * 60_000;
const MAX_STALL_RETRIES = 2;
// ② 周期性页面健康检查：每此毫秒复查是否掉登录 / 人机验证 / 报错弹窗
const HEALTH_CHECK_MS = 90 * 1000;
// ChatGPT 已迁移到 Lexical/ProseMirror；Playwright keyboard.insertText() 对超长文本会迟迟
// 不返回，即使文本已写进编辑器。改用原生 insertText 事件，并保留硬超时保护。
//
// ⚠️ 实测（2026-09-10）：ChatGPT composer 的 insertText 成本几乎全在「换行」上——
//   单行 15000 字符 ≈ 3ms；而 60 行 / 2000 字符 ≈ 19s；真实 7 图模板 396 行 / 12940 字符
//   ≈ 120s（约 300ms 每个换行）。因此：
//   1) 超时必须从 45s 提高，否则长模板必然触发「ChatGPT 编辑器写入超时（>45s）」；
//   2) 必须分块插入并让出主线程，避免单次调用长时间完全阻塞 renderer。
const COMPOSER_INSERT_TIMEOUT_MS = 300_000;
// 分块大小：按字符切分。分块不会降低总耗时（成本在换行），但能让出主线程、
// 保证 CDP evaluate 有机会回传进度，且避免单次调用被 Chrome 判定为无响应。
const COMPOSER_INSERT_CHUNK = 600;
// 写入完成后等待「发送按钮 enabled」的轮询上限（50ms/次）。长模板写入后
// Lexical 仍需时间 reconcile，4s 窗口过短。
const COMPOSER_SUBMIT_MAX_ATTEMPTS = 600; // ≈30s
// ===== 对话输入框定位（单一真相，2026-10-24 修复）=====
// ChatGPT 新版页面**同时存在两个** contenteditable[role="textbox"]（实测）：
//   ① 主对话输入框：<div class="ProseMirror" role="textbox" aria-label="询问 ChatGPT">（高 36px，贴视口底部）
//   ② Canvas/写作块文档编辑器：<div class="ProseMirror leading-relaxed" role="textbox" aria-label="开始写作">
//      （实测高 5138px，位于正文区）
// 旧选择器 `div[contenteditable="true"][role="textbox"]` 按 DOM 顺序先命中 ②，
// 后果是一整条链跑错元素：prompt 被写进文档编辑器（分块 insertText 写数千行 → 极慢/卡死），
// 而写入校验又从同一个元素读回 → 误判"写入成功"，最后卡在"发送按钮未就绪"。
// 修复原则：语义锚点优先（ChatGPT/询问/Message/Ask/Message ChatGPT），
// 兜底项用 :not() 显式排除写作/文档/画布编辑器；调用处再加"高度 > 视口 70% 即拒绝写入"的断言。
export const COMPOSER_SELECTOR = [
    "#prompt-textarea",
    'textarea[data-testid="prompt-textarea"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    '[contenteditable="true"][role="textbox"][aria-label*="ChatGPT"]',
    '[contenteditable="true"][role="textbox"][aria-label*="询问"]',
    '[contenteditable="true"][role="textbox"][aria-label*="Message"]',
    '[contenteditable="true"][role="textbox"][aria-label*="Ask "]',
    // 兜底：任意 contenteditable textbox，但排除 Canvas / 写作块 / 文档编辑器（中英文标签都排）
    '[contenteditable="true"][role="textbox"]:not([aria-label*="写作"]):not([aria-label*="Write"]):not([aria-label*="write"]):not([aria-label*="编辑"]):not([aria-label*="Edit"]):not([aria-label*="画布"]):not([aria-label*="Canvas"])',
].join(", ");

// CDP 单次 DOM 读取的硬超时。CDP 断连后 Playwright 的 innerText / isEnabled / count /
// evaluate / isVisible 可能**永不返回**（2026-10-23 实测：MVP5 完成后 product-facts 桥接
// 在此静默挂 20 分钟，日志冻结、下游产物缺失）。逐调用设上限后，坏连接会在 ~15s 内
// 以 code=CDP_CALL_TIMEOUT 失败，交给 sendPromptOnce 的重连重试分支处理。
const CDP_DOM_READ_TIMEOUT_MS = 15_000;
// 单次 attemptOnce 的外层安全网：即使某个内部调用漏了包装，也不可能无限挂。
// 取 600s 是为了不误伤合法长任务（insertComposerText 自身上限 300s + waitForSendReady 180s）。
const ATTEMPT_HARD_DEADLINE_MS = 600_000;
// 2026-10 新版 ChatGPT 去掉了 data-message-author-role，改用：
//   用户气泡 data-user-message-bubble="true" / 助手回复 data-conversation-role="assistant"
// 两套并存，旧选择器在前，保证 A/B 回滚或分语言版本下都能命中。
const MSG_USER_SELECTOR = '[data-message-author-role="user"], [data-user-message-bubble="true"]';
const MSG_ASSISTANT_SELECTOR = '[data-message-author-role="assistant"], [data-conversation-role="assistant"]';
const MSG_ALL_SELECTOR = `${MSG_USER_SELECTOR}, ${MSG_ASSISTANT_SELECTOR}`;
// 生成图选择器（覆盖多语言/版本）。抽成常量，供 generatedImages() 与 generatedImageLastSrc() 共用。
const GENERATED_IMAGE_SELECTOR = [
    'img[alt^="已生成图片"]',
    'img[alt^="Generated image"]',
    'img[alt^="Image generated"]',
    'img[alt*="已生成"]',
    'img[alt*="生成图片"]',
    'img[alt*="Generated"]',
    'img[alt*="generation"]',
    '[data-testid="generated-image-preview"] img',
    '[data-testid="generated-image-gallery"] img'
].join(", ");
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export class ChatGptAdapter {
    browser;
    context;
    page;
    /** 并发锁：防止多个调用同时清空/重建 browser/context/page 导致竞态 */
    _launching = null;
    /**
     * 目标商品对话 URL（由 openChat 设定）。
     *
     * 为什么需要它（2026-10-23 实测踩坑）：
     * Chrome 里常同时开着多个 ChatGPT 标签（如「生成采购表格」「生成每日采购表格」
     * 「产品事实提取」）。launch() 原来按 `url.includes("chatgpt.com")` 取**第一个**
     * 匹配页，一旦重连（resetStuckComposerConnection / reconnectAndRecheck）就可能
     * 选中别的对话 —— 之后 composer 写入、发送按钮检测全落在错误标签上，
     * 表现为「发送按钮未在 30 秒内就绪」而整批失败。
     * 记住目标 URL 后，launch() 优先回到正在做的那个对话。
     */
    _targetChatUrl = null;
    /**
     * 当前 ChatGPT 会话内已上传的产品图片签名（排序后的路径拼接）。
     *
     * 背景（2026-10-23 用户反馈「一个产品的对话框里面不用重复提交产品图片」）：
     * 同一商品的 10 张 Listing 图在**同一个对话**里逐张生成，而 ChatGPT 在消息发送后
     * 会清空 composer，旧的 `composerAttachmentCount` 复用判定因此永远失效，
     * 导致每张图都重新上传同一批 3 张源图 —— 10 张 × 3 张 = 30 次上传，其中 27 次纯重复。
     * 重复上传只会撑大会话上下文、拉长上传耗时，并加剧生成漂移与超时
     * （实测任务在 Image 7 因「等待图片生成完成超时 8 分钟」失败）。
     *
     * 会话内此前消息里的图片附件仍在模型上下文中，无需重复提交。
     * ⚠️ 换对话 / 重连 CDP 后必须 resetUploadedImages()，否则会误判为已上传而完全不附图。
     */
    _uploadedImagesSignature = null;
    /** 计算一组图片的稳定签名，用于跨调用比对「是否同一批图」。 */
    imagesSignature(paths) {
        return [...paths].sort().join("|");
    }
    /** 换会话或重连后调用：丢弃「已上传」记忆，强制下次重新附图。 */
    resetUploadedImages() {
        this._uploadedImagesSignature = null;
    }
    /**
     * 给可能永不返回的 CDP/Playwright 调用加硬超时。
     * - 超时抛 code=CDP_CALL_TIMEOUT 的错误（sendPromptOnce 会据此断开重连后重试一次）；
     * - 对底层 promise 挂一个空 catch，避免超时后它最终拒绝时产生 unhandledRejection；
     * - 底层调用本身不会被"取消"，但重连（resetStuckComposerConnection）关闭旧 CDP 会话时
     *   会随连接一起终止，不会泄漏。
     */
    _withDeadline(promise, ms = CDP_DOM_READ_TIMEOUT_MS, label = "CDP 调用") {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error(`CDP 调用超时（>${ms}ms）：${label}`);
                error.code = "CDP_CALL_TIMEOUT";
                reject(error);
            }, ms);
        });
        promise.catch(() => { });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }
    async launch() {
        // 快路径：已有可用连接直接复用
        if (this.browser?.isConnected() &&
            this.page &&
            !this.page.isClosed()) {
            void this.page.bringToFront().catch(() => {});
            return this.page;
        }
        // 并发保护：若已有 launch() 在执行中，等它完成后再复用结果（避免互相清空状态）
        if (this._launching) {
            try { return await this._launching; }
            catch { /* 上一次 launch 失败，下面会重试 */ }
        }
        const doLaunch = async () => {
            this.page = undefined;
            this.context = undefined;
            this.browser = undefined;
            await access(CHROME_PATH);
            // 外层 catch 启动 Chrome + 内层 connectToChrome 均有重试；这里再包一层防内层异常穿透
            const context = await this.connectToChrome().catch(async () => {
                console.warn("[chatgpt] 首次 CDP 连接失败，尝试启动 Chrome...");
                this.startNormalChrome();
                await this.waitForChromeDebugPort();
                return this.connectToChrome();
            });
            // 选页面：有目标对话 URL 时，必须回到正在做的那个对话。
            // Chrome 常同时开着多个 ChatGPT 标签（采购表格 / 产品事实提取…），
            // 若按 `url.includes("chatgpt.com")` 取第一个，重连后会选中错误标签，
            // 后续 composer 写入与发送按钮检测全部落空 → 报「发送按钮未在 30 秒内就绪」。
            const target = this._targetChatUrl;
            const pages = context.pages();
            let chosen;
            if (target) {
                chosen = pages.find((candidate) => candidate.url() === target);
                if (!chosen) {
                    // 目标标签被关掉了：复用任意 ChatGPT 页（或新开一页）再导航回目标对话
                    chosen = pages.find((candidate) => candidate.url().includes("chatgpt.com")) ?? pages[0] ?? (await context.newPage());
                }
            }
            else {
                chosen = pages.find((candidate) => candidate.url().includes("chatgpt.com")) ?? pages[0] ?? (await context.newPage());
            }
            this.page = chosen;
            if (target && this.page.url() !== target) {
                await this.page.goto(target, { waitUntil: "domcontentloaded" });
            }
            else if (!this.page.url().includes("chatgpt.com")) {
                await this.page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded" });
            }
            void this.page.bringToFront().catch(() => {});
            return this.page;
        };
        this._launching = doLaunch();
        try {
            return await this._launching;
        } finally {
            this._launching = null;
        }
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
        // 兜底失败：很可能当前 this.page 是 CDP 断连前留下的「陈旧引用」。
        // 该引用上的 locator 会立刻抛 "Target page, context or browser has been closed"，
        // 于是被误判成「未登录」。这里强制重连一次再复判，避免假阴性。
        if (!ready) {
            const recovered = await this.reconnectAndRecheck();
            if (recovered) {
                page = this.page;
                ready = true;
            }
        }
        if (ready) {
            const imageUpload = await this.checkImageUploadReady(page);
            return { ready: true, status: "ready", url: page.url(), imageUpload };
        }
        const pageText = await page
            .locator("body")
            .innerText({ timeout: 5_000 })
            .catch(() => "");
        return {
            ready: false,
            status: await this.classifyNotReady(page, pageText),
            url: page.url()
        };
    }
    /**
     * 判定「composer 不可见」的真正原因。
     * 之前一律报 login_required，把 CDP 断连、页面未加载完、页面结构变化
     * 全说成「没登录」，用户反复登录也解决不了。
     *
     * 登录态判定刻意不用「登录」等中文词做 innerText 匹配——侧边栏的历史
     * 会话标题里就可能出现这些字（实测本项目任务名含「登录」），会误判。
     * 改用登录页特有的 DOM 特征（/auth/ 链接）判断，精度高得多。
     */
    async classifyNotReady(page, pageText) {
        const verificationRequired = /verify you are human|真人验证|验证您是真人|checking your browser|执行安全验证/i.test(pageText);
        if (verificationRequired) {
            return "verification_required";
        }
        let hasAuthEntry = false;
        try {
            hasAuthEntry = (await page
                .locator('a[href*="/auth/login"], a[href*="/auth/signup"], button[data-testid*="login"], a[data-testid*="login"]')
                .count()) > 0;
        }
        catch {
            // 页面已关闭 / 无法查询 → 按「输入框不可用」处理
        }
        if (hasAuthEntry) {
            return "login_required";
        }
        return "composer_unavailable";
    }
    /**
     * 强制丢弃陈旧 CDP 引用并重连，然后重新判定 composer 是否可见。
     * 触发场景：Chrome CDP 断连后 this.browser 被置空、this.page 指向已关闭的旧页面，
     * 此时任何 locator 调用都会立即失败（不是超时），旧的 findReadyPage 因
     * `!this.browser` 早退而无法兜底，最终被误报成「未登录」。
     */
    async reconnectAndRecheck() {
        try {
            // 先把旧 browser 的断连回调摘掉：否则旧会话稍后触发 'disconnected' 时，
            // 回调会把刚建立好的 this.page / this.browser 再次置空，形成竞态。
            if (this.browser && typeof this._disconnectHandler === "function") {
                this.browser.off("disconnected", this._disconnectHandler);
            }
            // CDP 重连后页面/会话可能已变，丢弃图片上传记忆，强制下次重新附图
            this.resetUploadedImages();
            this.page = undefined;
            this.context = undefined;
            this.browser = undefined;
            await this.launch();
            if (!this.page || this.page.isClosed()) {
                return false;
            }
            const visible = await this.composer(this.page)
                .waitFor({ state: "visible", timeout: LOGIN_WAIT_MS })
                .then(() => true)
                .catch(() => false);
            if (!visible) {
                const readyPage = await this.findReadyPage();
                if (!readyPage) {
                    return false;
                }
                this.page = readyPage;
                this.context = readyPage.context();
            }
            return true;
        }
        catch {
            return false;
        }
    }
    async findReadyPage() {
        // browser 断连时 this.browser 已被置空。此时不能直接早退——
        // 应尝试自行重连 CDP，否则所有兜底路径都会失效。
        if (!this.browser || !this.browser.isConnected()) {
            try {
                await this.connectToChrome();
            }
            catch {
                return undefined;
            }
        }
        if (!this.browser || !this.browser.isConnected()) {
            return undefined;
        }
        // 有目标对话时优先找它：多 ChatGPT 标签场景下，随便找一个「有 composer 的
        // chatgpt 页」可能选中别的对话（如采购表格），把后续 Prompt 发错地方。
        const pages = this.browser.contexts().flatMap((context) => context.pages());
        const ordered = this._targetChatUrl
            ? [
                ...pages.filter((candidate) => candidate.url() === this._targetChatUrl),
                ...pages.filter((candidate) => candidate.url() !== this._targetChatUrl)
            ]
            : pages;
        for (const page of ordered) {
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
        return undefined;
    }
    async checkImageUploadReady(page) {
        const targetPage = page ?? await this.requirePage();
        const input = targetPage
            // #upload-files is ChatGPT's generic file input.  It can accept an image
            // selection without adding it to the composer, so it is not evidence that
            // a product image can be attached to the current message.
            .locator('input[data-testid="upload-photos-input"], input[aria-label="添加照片"], input[aria-label="Add photos"], input[type="file"][accept^="image/" i]:not(#upload-files):not([capture])')
            .first();
        if ((await input.count()) === 0) {
            return {
                ready: false,
                reason: "找不到 ChatGPT 图片上传控件"
            };
        }
        if (await input.isDisabled().catch(() => true)) {
            return {
                ready: false,
                reason: "ChatGPT 的“添加照片和文件”入口当前被禁用，可能为附件额度限制或页面未恢复"
            };
        }
        return { ready: true };
    }
    async clearComposerDraft(page = this.page) {
        if (!page || page.isClosed()) {
            return;
        }
        await page.evaluate((sel) => {
            const composer = document.querySelector(sel);
            if (!composer || !(composer.textContent || "").trim()) {
                return;
            }
            composer.focus();
            composer.innerHTML = "";
            composer.dispatchEvent(new Event("input", { bubbles: true }));
        }, COMPOSER_SELECTOR).catch(() => {});
    }
    async createBlankChat() {
        // 新对话：此前会话里上传的产品图不在上下文内，必须重新上传
        this.resetUploadedImages();
        // 新对话尚未产生具体 URL，先清空目标；发送成功后由 sendPromptOnce 同步
        this._targetChatUrl = null;
        // 强制终止可能残留的生成态：批量模式下前一行失败/停滞时 stop-button 可能仍在，
        // 直接导航到新对话会导致后续 waitForSendReady 卡住。先点 stop 再切首页。
        if (this.page && !this.page.isClosed()) {
            await this.clickStopSafely(this.page);
        }
        // 创建新对话需要重新导航到首页，不跳过已有 URL
        const url = await this.navigateWithRetry(CHATGPT_URL, () => false);
        // 关键：domcontentloaded 不等 React 替换完页面，批量模式下上一行的 stop-button DOM
        // 仍可能残留在 composer 节点上，导致下一行 sendPromptOnce 的 waitForSendReady 误判。
        // 主动等 stop-button 消失（30s）+ 二次确认 URL 不在会话内（防止被 ChatGPT 重定向到旧对话）。
        await this._settleBlankChat(url, 30_000);
        // 产品图会在 sendPromptOnce 清草稿之前上传；这里先清掉前一轮失败残留的草稿，
        // 避免它影响 ChatGPT 的附件入口状态。
        await this.clearComposerDraft(this.page);
        return this.page ? this.page.url() : url;
    }
    // 等待 createBlankChat 后的页面真正"稳"：URL 不在 c/ 会话内 + stop 按钮不可见。
    // 设计：批量模式 row N 完成后，row N+1 立即 createBlankChat 时，旧 chat 的 composer
    // 仍可能在 DOM 里短暂残留 stop-button，必须等 React 把页面替换成新 chat 才放行。
    async _settleBlankChat(fallbackUrl, timeoutMs = 30_000) {
        const page = await this.requirePage();
        const stop = this.stopButton(page);
        const deadline = Date.now() + timeoutMs;
        let lastDiag = "";
        while (Date.now() < deadline) {
            const currentUrl = page.url();
            const stopVisible = await stop.isVisible().catch(() => false);
            const inConversation = /^https:\/\/chatgpt\.com\/c\//.test(currentUrl);
            if (!stopVisible && !inConversation) return;
            if (inConversation) {
                // 被 ChatGPT 重定向到旧 chat，强制再次跳回首页
                try { await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 15_000 }); }
                catch { /* 允许后续重试 */ }
            }
            if (stopVisible) {
                lastDiag = `stop-button 仍可见，已等 ${Math.round((timeoutMs - (deadline - Date.now())) / 1000)}s`;
                // 主动点 stop（如可点）加速 ChatGPT 把页面切到 send 态
                await this.clickStopSafely(page);
            }
            await page.waitForTimeout(600);
        }
        // 即使超时，也只告警不抛错——下一道 waitForSendReady 仍会兜底。
        // 强行抛错会污染 createBlankChat 的契约（旧调用方认为它只是导航）。
        if (lastDiag) {
            console.warn(`[chatgpt] _settleBlankChat 软超时：${lastDiag}（继续走 waitForSendReady 兜底）`);
        }
    }
    async openChat(chatUrl) {
        await this.launch();
        // 记住目标对话：后续任何重连（resetStuckComposerConnection / reconnectAndRecheck）
        // 都会凭它回到这个标签，避免 Chrome 多开 ChatGPT 标签时选错页面。
        this._targetChatUrl = chatUrl;
        // 恢复会话后重置「已上传」记忆：server 重启会丢失该状态，
        // 若不重置，恢复跑图时会误判为已上传而完全不附图。
        this.resetUploadedImages();
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
                void page.bringToFront().catch(() => {});
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
    /**
     * 上传产品图片到当前 composer。
     * 返回 { attached, reason }：
     *   attached=true  → 本条消息会带上产品图（本次上传成功，或 composer 里已有可复用附件）
     *   attached=false → 本条消息不带图（同一会话早已上传过同一批图）
     * 调用方据此决定 Prompt 文案：附件在「本条消息」还是「本对话历史」。
     */
    async uploadImages(paths, options = {}) {
        if (!Array.isArray(paths) || paths.length === 0) {
            throw new Error("没有可上传的产品图片");
        }
        const signature = this.imagesSignature(paths);
        // 同一会话内已上传过同一组产品图 → 不再重复提交。
        // ChatGPT 会话中此前消息里的图片附件仍在模型上下文内；
        // 重复上传只会撑大上下文、拉长耗时，并加剧生成漂移/超时。
        if (this._uploadedImagesSignature === signature) {
            console.warn(`[chatgpt] 本对话已上传过同一组 ${paths.length} 张产品图，跳过重复上传（图片仍在本对话历史消息中）`);
            return { attached: false, reason: "session-duplicate" };
        }
        const page = await this.requirePage();
        // 上一次中断可能已把同一批图片留在新对话的 composer 中。先复用可见附件，
        // 绝不能再 setInputFiles，否则 ChatGPT 会拦截并弹出“你已上传过此文件”。
        // skipComposerReuse：本次要追加的是**另一组**图片（如参考风格图），
        // composer 里已有的产品图数量会 >= 本组数量，按旧逻辑会误判「可复用」而完全不传。
        const existingAttachmentCount = await this.composerAttachmentCount(page);
        if (!options.skipComposerReuse && existingAttachmentCount >= paths.length) {
            console.warn(`[chatgpt] composer 已有 ${existingAttachmentCount} 个附件（本次需要 ${paths.length}），复用现有附件，不重复上传`);
            this._uploadedImagesSignature = signature;
            return { attached: true, reason: "composer-reuse" };
        }
        // ChatGPT 同时渲染通用文件、图片和相机三个 input。通用 #upload-files
        // 在当前 UI 中不会把图片带入 composer；必须优先命中图片专用入口。
        let input = page.locator('input[data-testid="upload-photos-input"], input[aria-label="添加照片"], input[aria-label="Add photos"], input[type="file"][accept^="image/" i]:not(#upload-files):not([capture])').first();
        if ((await input.count()) === 0) {
            await this.clickAttachmentButton(page);
            input = page.locator('input[data-testid="upload-photos-input"], input[aria-label="添加照片"], input[aria-label="Add photos"], input[type="file"][accept^="image/" i]:not(#upload-files):not([capture])').first();
            await input.waitFor({ state: "attached", timeout: 10_000 });
        }
        // ChatGPT 会在文件上传额度耗尽、当前页面尚未就绪等情况下保留 input 节点但禁用它。
        // 直接 setInputFiles 不会产生附件，却会让后续轮询白等 90 秒；必须在这里给出
        // 可操作的阻断说明，且绝不能把无附件状态继续当作产品识别输入。
        const uploadReadiness = await this.checkImageUploadReady(page);
        if (!uploadReadiness.ready) {
            throw new Error(`${uploadReadiness.reason}。请稍后在同一 ChatGPT 页面确认该菜单可点击后重试；系统不会发送无图产品识别 Prompt。`);
        }
        // 2026-10 新版「添加照片」入口是单选 input（无 multiple），一次性传多张会直接抛
        // "Non-multiple file input can only accept single file"。这里按 multiple 能力分流：
        // 多选入口一次传完；单选入口逐张传，最后由附件计数统一复核。
        const acceptsMultiple = await input.evaluate((el) => Boolean(el.multiple)).catch(() => false);
        if (paths.length > 1 && !acceptsMultiple) {
            for (const one of paths) {
                await input.setInputFiles(one);
                await page.waitForTimeout(600);
            }
        }
        else {
            await input.setInputFiles(paths);
        }
        // ChatGPT 完成接收后会立即重建 file input；此时 input.files 变为 0 是正常现象，
        // 并不表示上传失败。此前据此再次 setInputFiles，会让 ChatGPT 拒绝同一文件并弹出
        // “你已上传过此文件”，自动化随之卡在弹窗上。上传结果只以 composer 内可见附件为准，
        // 不再对同一路径做自动二次上传。
        const visibleCount = await this.waitForAttachmentCount(page, paths.length);
        if (visibleCount < paths.length) {
            throw new Error(`ChatGPT 未确认全部产品图片已附加（期望 ${paths.length}，可见 ${visibleCount}）。请检查附件区或缩减单次图片数后重试；系统不会在未确认附件时发送产品识别 Prompt。`);
        }
        // 上传成功：记录签名，供同一会话内的后续消息跳过重复上传
        this._uploadedImagesSignature = signature;
        return { attached: true };
    }
    async enableWebSearch() {
        try {
            await this.selectComposerTool("网页搜索", [
                "搜索网页",
                "Search the web"
            ], [
                "搜索网络",
                "Web search",
                "Search web"
            ]);
        }
        catch (error) {
            // 新版 ChatGPT 会把网页搜索并入模型的自动工具路由，或不再在 [+] 菜单中暴露
            // 单独的开关。识别 Prompt 已明确要求联网检索，此时继续发送比因旧菜单选择器
            // 失败而暂停整个任务更可靠；实际回复仍由后续结构化结果校验把关。
            console.warn(`[chatgpt] 未找到独立“网页搜索”菜单，将使用模型自动联网能力继续：${error?.message || error}`);
        }
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
            // 关键：创建图片工具未启用时静默继续 = ChatGPT 在普通模式下收到生图请求 → 退回消息或要求用户上传图片，
            // 工作台白白等满 8 分钟再超时，体验极差。这里直接抛出，让用户先切工具再点重试。
            throw new Error(`ChatGPT 未切换到「创建图片」工具（${error?.message || error}）。请手动在 ChatGPT composer 点 [+] → 选择「创建图片 / Describe an image / DALL-E」，然后在工作台重新点击「逐张生成 7 张图」。`);
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
        // 2026-10 新 UI：composer 的 [+] 变成 aria-label="添加文件等内容"。
        // 旧写法 button[aria-label*="添加"] 会误中左侧栏的「添加…」按钮，
        // 点击被侧栏滚动容器拦截而卡死数十秒。优先精确匹配，并把兜底限定在表单内。
        const plusButton = page
            .locator('button[data-testid="composer-plus-btn"], button[aria-label="添加文件等内容"], button[aria-label="Add files and more"], form button[aria-label*="附 加"], form button[aria-label*="Attach"], form button[aria-label*="工具"], form button[aria-label*="Tools"], form button[aria-label*="添加"], button[aria-label*="Attach"], button[aria-label*="Upload"]')
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
                await plusButton
                    .click({ timeout: 5_000 })
                    .catch(() => plusButton.click({ force: true, timeout: 5_000 }))
                    .catch((error) => {
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
        // 菜单可能被侧栏/浮层遮挡：普通点击失败时退回 DOM 派发，避免整轮卡住
        await toolOption
            .click({ timeout: 5_000 })
            .catch(() => toolOption.dispatchEvent("click"))
            .catch((error) => {
                console.warn(`[chatgpt] 工具菜单项点击失败：${error?.message || error}`);
            });
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
        if (chipVisible)
            return;
        // 新版 ChatGPT 切换工具后可能不再展示 placeholder/chip 指示器；
        // 菜单项已成功点击即视为工具已激活，不再抛错中断自动化流程。
        console.warn(`[chatgpt] ${toolName} 已点击菜单项，但 placeholder/chip 未检测到，信任点击已启用（URL: ${url}）`);
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
    async waitForGeneratedImageAndDownload(previousGeneratedImageCount, outputPath, timeoutMs = 12 * 60_000) {
        const page = await this.requirePage();
        // 2026-10-24：8 分钟对慢模型/复杂 prompt 不够（实测单图可达 9-10 分钟）。默认提到 12 分钟；
        // 重试前的"回收上一轮迟到图"可用较短 timeoutMs。
        const imageWaitMs = timeoutMs;
        const deadline = Date.now() + imageWaitMs;
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
            const generatedImageCount = await generatedImages.count().catch(() => 0);
            // 双模兼容：
            //  - 传 number（bag-charm / luxury-insert 等旧调用）→ 按数量增量判断（旧行为）；
            //  - 传 string / undefined（单品上品流程）→ 按最后一张图 src 变化 + naturalWidth 判断。
            //    DOM 虚拟化/懒加载会让 count 抖动（实测 5↔4），按数量会永远判不到新图 → 超时。
            const srcMode = typeof previousGeneratedImageCount !== "number";
            let isNew = false;
            if (generatedImageCount > 0) {
                if (srcMode) {
                    const lastInfo = await generatedImages.nth(generatedImageCount - 1)
                        .evaluate((el) => ({ src: el.currentSrc || el.src || "", w: el.naturalWidth }))
                        .catch(() => null);
                    isNew = !!lastInfo && lastInfo.w >= 600 &&
                        (!previousGeneratedImageCount || lastInfo.src !== previousGeneratedImageCount);
                }
                else {
                    isNew = generatedImageCount > previousGeneratedImageCount;
                }
            }
            if (!stopVisible && isNew) {
                detectedAt ??= Date.now();
                if (Date.now() - detectedAt >= 3_000) {
                    // 保存前重取一次数量，避免虚拟化导致索引越界
                    const saveIndex = Math.max(0, (await generatedImages.count().catch(() => 0)) - 1);
                    await this.saveGeneratedImage(generatedImages.nth(saveIndex), outputPath);
                    return;
                }
            }
            else {
                detectedAt = undefined;
            }
            await page.waitForTimeout(1_000);
        }
        throw new Error(`等待图片生成完成超时（${Math.round(imageWaitMs / 60000)} 分钟，未检测到新的完整图片）`);
    }
    async recoverCompletedGeneratedImages(outputDirectory, knownImageNumbers) {
        const page = await this.requirePage();
        const stopVisible = await this.stopButton(page)
            .isVisible()
            .catch(() => false);
        const messages = page.locator(MSG_ALL_SELECTOR);
        const count = await messages.count();
        const recovered = new Set(knownImageNumbers);
        let pendingImageNumber;
        for (let index = 0; index < count; index += 1) {
            const message = messages.nth(index);
            const role = await message.evaluate((el) => el.getAttribute("data-message-author-role") ??
                el.getAttribute("data-conversation-role") ??
                (el.getAttribute("data-user-message-bubble") ? "user" : null));
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
    // 【旧版 UI 回退】ChatGPT 老 composer 的两个 __composer-pill（模型 pill + 推理 pill）。
    // 2026-10-24 起官方已移除该类名 → 本函数只作为账号灰度/回滚时的兜底，新流程见 ensureChatGptModelAndReasoning。
    // 同一对话内支持按任务切换：仅当对话 / 模型 / 推理档位任一不同才重新对齐，避免每次发送都反复开菜单。
    // desired: { model?, reasoning? } —— 不传则用全局 CHATGPT_MODEL / CHATGPT_REASONING。
    async _ensureLegacyComposerPill(page, desired) {
        const modelTarget = (desired?.model || CHATGPT_MODEL || "GPT-5.6 Sol").toString().trim();
        const reasonTarget = (desired?.reasoning || CHATGPT_REASONING || "高").toString().trim(); // 低 / 中 / 高
        try {
            const url = page.url();
            // 用对话 ID（URL path 末段 /c/<uuid> 或 temporary-chat）判重，而非完整 URL：
            // ChatGPT 对话 URL 常带变化的 query/hash，用完整 URL 判重会失效 → 每次发送都重弹模型菜单（左面板跳动）。
            const convId = (url.match(/\/c\/([a-z0-9-]+)/i) || [])[1]
                || (/\/temporary-chat/i.test(url) ? "temporary" : (url || "default"));
            // 目标模型/推理档与已对齐的一致则跳过（支持按任务切换：desired 变化时才重开菜单）
            if (this._ensuredModelConv === convId && this._ensuredModel === modelTarget && this._ensuredReasoning === reasonTarget) {
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
            this._ensuredModel = modelTarget;
            this._ensuredReasoning = reasonTarget;
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

    // ===== ChatGPT 模型 / 推理档位对齐（2026-10-24 重写，适配新版「选择 ChatGPT 模型」弹层）=====
    // 背景：新版 composer 只剩一个入口按钮 button[aria-label="选择 ChatGPT 模型"]，
    // 官方同时移除了 button.__composer-pill 类名 → 旧逻辑每次都在「未找到 pill」处跳过，
    // 也就是「自动选模型」长期静默失效（实测对话一直跑在账号上次选的 GPT-6 上）。
    //
    // 新版弹层内部结构（chatgpt.com 实测）：
    //   模型列表  div[role="menuitemradio"]  文本 "GPT-6" / "GPT-5.6 Sol"，aria-checked 标识选中
    //   强度滑杆  div[role="menuitem"][aria-label="强度"]（data-reasoning-slider）3 档 = 即时 / 中 / 高
    //   视图切换  button[role="menuitem"][aria-label="选择模型"]（在「模型列表」与「强度」两视图间 toggle）
    // ⚠️ 两个视图叠在同一位置：强度视图在前时模型项被 Range 轨道遮挡，Playwright 会报
    //    "ViewTrack ... intercepts pointer events"，必须先切到模型视图再点。
    // ⚠️ 强度滑杆不能点中心试探：点击位置直接等于设定值（点中心会把「高」降成「中」），
    //    必须按目标档位算 x 比例、一次点到位。
    // ⚠️ 强度档位只有 3 档且最低档叫「即时」（旧配置里的「低」需归一化到「即时」）。
    //
    // 非致命：任何一步失败只告警不阻断发送（沿用原设计），但会把实际状态写进日志便于排查。
    // desired: { model?, reasoning? } —— 不传则用全局 CHATGPT_MODEL / CHATGPT_REASONING。
    async ensureChatGptModelAndReasoning(page, desired) {
        // 有序候选链：任务显式指定的模型排最前，其后跟全局候选链（去重）
        const desiredModel = (desired?.model || "").toString().trim();
        const chain = (desiredModel
            ? [desiredModel, ...CHATGPT_MODEL_CHAIN.filter((m) => m !== desiredModel)]
            : CHATGPT_MODEL_CHAIN.slice());
        const reasonTarget = this._normalizeReasoning(desired?.reasoning || CHATGPT_REASONING || "高");
        try {
            const url = page.url();
            // 用对话 ID 判重（URL 常带变化的 query/hash，用完整 URL 会失效 → 每次发送都重弹菜单）
            const convId = (url.match(/\/c\/([a-z0-9-]+)/i) || [])[1]
                || (/\/temporary-chat/i.test(url) ? "temporary" : (url || "default"));
            // 命中缓存的键必须是「实际生效的候选」，不是链首；否则落链尾时每次都要重开菜单
            if (this._ensuredModelConv === convId
                && this._ensuredModel && chain.includes(this._ensuredModel)
                && this._ensuredReasoning === reasonTarget) {
                return;
            }
            const trigger = page.locator('button[aria-label="选择 ChatGPT 模型"]').first();
            const hasNewUi = (await trigger.count().catch(() => 0)) > 0;
            if (!hasNewUi) {
                console.warn("[chatgpt] 未找到新版模型按钮，回退旧版 composer-pill 逻辑");
                await this._ensureLegacyComposerPill(page, { model: chain[0], reasoning: reasonTarget });
                return;
            }
            // 快判：按钮文案形如「思考强度5.6 高」（模型短标 + 强度），符合目标就不弹菜单（避免 composer 抖动）。
            // 用「上次实际生效的候选」比短标，首次才用链首。
            const probeModel = (this._ensuredModelConv === convId && this._ensuredModel)
                ? this._ensuredModel
                : chain[0];
            const before = ((await trigger.textContent().catch(() => "")) || "").trim();
            const state = this._parseComposerPill(before, probeModel);
            if (state.modelOk && state.reason === reasonTarget) {
                this._ensuredModelConv = convId;
                this._ensuredModel = probeModel;
                this._ensuredReasoning = reasonTarget;
                this._ensuredModelOk = true;
                console.log(`[chatgpt] 模型/推理已符合「${before}」（候选 ${probeModel}），跳过切换（对话 ${convId}）`);
                return;
            }
            const modelRes = await this._alignChatGptModel(page, chain);
            const reasonDone = await this._alignChatGptReasoning(page, reasonTarget);
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(300);
            // 结果以菜单内核实为准（模型项 aria-checked / 强度「第 N 项」）；
            // composer 按钮文案只作日志参考 —— GPT-6 这类模型按钮上不显示短标，
            // 用文案判定会把「已切换成功」误报成「未确认」。
            const after = ((await trigger.textContent().catch(() => "")) || "").trim();
            const allOk = modelRes.ok && reasonDone;
            // ⚠ 只有全成功才写缓存。原实现失败也写，等于把「没切成」记成「已对齐」，
            // 后续同对话全部走快判跳过 —— 这是假成功的另一半。
            if (allOk) {
                this._ensuredModelConv = convId;
                this._ensuredModel = modelRes.model;
                this._ensuredReasoning = reasonTarget;
                this._ensuredModelOk = true;
            } else {
                this._ensuredModelConv = null;
                this._ensuredModel = null;
                this._ensuredReasoning = null;
                this._ensuredModelOk = false;
            }
            console.log(`[chatgpt] 模型对齐${allOk ? "成功" : "未完全确认"} → 「${after || "?"}」`
                + `（模型 ${modelRes.ok ? modelRes.matchedText : `✗${modelRes.error}`} / 强度 ${reasonTarget}${reasonDone ? "✓" : "✗"}，对话 ${convId}）`);

            if (!modelRes.ok) {
                const err = new Error(
                    `${modelRes.error}: ${modelRes.detail}｜当前菜单原文：`
                    + (modelRes.menu || []).map((m) => m.text).join(" | "),
                );
                err.code = modelRes.error;
                err.detail = modelRes.detail;
                err.menu = (modelRes.menu || []).map((m) => m.text);
                throw err;
            }
        }
        catch (e) {
            // G3：模型不可用 / 切换未确认 → 严格模式下硬失败，绝不带错模型继续跑。
            const hardCodes = [
                "MODEL_UNAVAILABLE",
                "AMBIGUOUS_MODEL",
                "MODEL_SWITCH_UNCONFIRMED",
                "MODEL_MENU_EMPTY",
                "MODEL_MENU_UNOPENED",
            ];
            if (e?.code && hardCodes.includes(e.code)) {
                if (CHATGPT_MODEL_STRICT) throw e;
                this._modelFallback = { code: e.code, detail: e.message, at: new Date().toISOString() };
                console.warn("[chatgpt] 模型不可用，但 CHATGPT_MODEL_STRICT=0 → 降级继续（产物质量不可保证）：", e.message);
                return;
            }
            console.warn("[chatgpt] 设置模型/推理档位失败（非致命，继续发送）：", e?.message || e);
        }
    }

    // 强度档位归一化：新 UI 只有 即时 / 中 / 高 三档，旧配置的「低」并入「即时」
    _normalizeReasoning(v) {
        const s = (v ?? "").toString().trim();
        if (/^(即时|低|最低|无|none|minimal|low)$/i.test(s))
            return "即时";
        if (/^(中|标准|standard|medium|mid)$/i.test(s))
            return "中";
        return "高"; // 高 / high / 超高 / 其它一律按最高档
    }

    // 模型短标：从 "GPT-5.6 Sol" 取 "5.6"，从 "GPT-6" 取 "6"（composer 按钮只显示短标）
    _modelTag(model) {
        const m = (model || "").match(/(\d+(?:\.\d+)?)/);
        return m ? m[1] : "";
    }

    // 数字短标按「数字边界」比较：'5.6' 里的 '6' 绝不能当成模型 6。
    // 这是 G1（短标误判）的根因修复——原实现用裸 includes，导致
    // 目标 GPT-6 与界面 5.6 互相误判为匹配，切换被跳过却报「已符合」。
    _numberTokenMatches(text, tag) {
        const t = (text || "").replace(/\s+/g, "");
        const g = (tag || "").trim();
        if (!t || !g) return false;
        const esc = g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        try {
            return new RegExp(`(?<![\\d.])${esc}(?![\\d.])`).test(t);
        } catch {
            return false;
        }
    }

    // 读 composer 按钮文案判断当前状态；文案形如「思考强度5.6 高」或「思考强度高」（无短标时）
    _parseComposerPill(text, modelTarget) {
        const s = (text || "").replace(/\s+/g, "");
        const tag = this._modelTag(modelTarget);
        const modelOk = this._numberTokenMatches(s, tag);
        const reason = /即时/.test(s) ? "即时" : /中/.test(s) ? "中" : /高/.test(s) ? "高" : "";
        return { modelOk, reason, raw: s };
    }

    // 菜单是否已打开
    async _isModelMenuOpen(page) {
        return await page.evaluate(() => {
            const m = document.querySelector('[role="menu"]');
            if (!m) return false;
            const r = m.getBoundingClientRect();
            return r.width > 20 && r.height > 20;
        }).catch(() => false);
    }

    // 首个匹配元素的中心点是否真能点到（未被叠加的强度视图遮挡）
    async _isHittable(page, selector) {
        return await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) return false;
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (!top) return false;
            return top === el || el.contains(top);
        }, selector).catch(() => false);
    }

    // 读菜单里当前的强度档位（菜单文案含「第 N 项，共 3 项」；N=1 即时 / 2 中 / 3 高）
    async _readReasoningFromMenu(page) {
        const t = await page.evaluate(() => {
            const m = document.querySelector('[role="menu"]');
            return m ? (m.textContent || "").trim() : "";
        }).catch(() => "");
        const n = t.match(/第\s*(\d+)\s*项/);
        if (n) return ["即时", "中", "高"][Number(n[1]) - 1] || "";
        if (/即时/.test(t)) return "即时";
        if (/中/.test(t)) return "中";
        if (/高/.test(t)) return "高";
        return "";
    }

    // 打开模型弹层；已在打开状态则复用
    async _openChatGptModelMenu(page) {
        if (await this._isModelMenuOpen(page)) return true;
        await page.locator('button[aria-label="选择 ChatGPT 模型"]').first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(700);
        return await this._isModelMenuOpen(page);
    }

    // 对齐模型（不涉及强度）：切到模型视图 → 按候选链选目标项 → 回读 aria-checked。
    // 返回 { ok, model, error?, menu }，绝不以 false 静默了事（G3）。
    async _alignChatGptModel(page, modelTargets) {
        const chain = (Array.isArray(modelTargets) ? modelTargets : [modelTargets])
            .map((s) => (s ?? "").toString().trim())
            .filter(Boolean);
        if (!chain.length) {
            return { ok: false, error: "MODEL_UNAVAILABLE", detail: "候选链为空", menu: [] };
        }
        if (!(await this._openChatGptModelMenu(page))) {
            return { ok: false, error: "MODEL_MENU_UNOPENED", detail: "模型弹层未打开", menu: [] };
        }
        // 强度视图在前 → 模型项被轨道遮挡，先切到「选择模型」视图
        if (!(await this._isHittable(page, '[role="menuitemradio"]'))) {
            const tab = page.locator('[role="menuitem"][aria-label="选择模型"]').first();
            if (await tab.count().catch(() => 0)) {
                await tab.click({ timeout: 4000 }).catch((e) => console.warn("[chatgpt] 切到模型视图失败：", e?.message || e));
                await page.waitForTimeout(600);
            }
        }
        const radios = page.locator('[role="menuitemradio"]');
        const n = await radios.count().catch(() => 0);
        if (!n) {
            return { ok: false, error: "MODEL_MENU_EMPTY", detail: "模型列表为空", menu: [] };
        }
        // 一次性读完菜单（项数 × 2 次属性读取），后续纯离线匹配，避免边点边读
        const menu = [];
        let checkedIdx = -1;
        for (let i = 0; i < n; i += 1) {
            const text = ((await radios.nth(i).textContent().catch(() => "")) || "").trim();
            const checked = await radios.nth(i).getAttribute("aria-checked").catch(() => "");
            if (checked === "true") checkedIdx = i;
            menu.push({ i, text, checked: checked === "true" });
        }
        const menuText = menu.map((m) => `${m.text}${m.checked ? "*" : ""}`).join(" | ");

        const resolved = this._resolveModelIndex(menu, chain);
        if (resolved.error) {
            // 关键：把菜单原文打出来，人工能一眼看出该配哪个完整模型名
            console.warn(`[chatgpt] ${resolved.error}：${resolved.detail}`);
            console.warn(`[chatgpt] 当前菜单原文（* = 已选中）：${menuText}`);
            return { ok: false, error: resolved.error, detail: resolved.detail, menu };
        }
        const { idx, model, level } = resolved;
        if (idx === checkedIdx) {
            console.log(`[chatgpt] 模型已是「${menu[idx].text}」（候选 ${model} / ${level}）`);
            return { ok: true, model, level, menu, matchedText: menu[idx].text };
        }
        await radios.nth(idx).click({ timeout: 6000 }).catch((e) => console.warn("[chatgpt] 点击模型项失败：", e?.message || e));
        await page.waitForTimeout(900);
        const ok = (await radios.nth(idx).getAttribute("aria-checked").catch(() => "")) === "true";
        if (!ok) {
            console.warn(`[chatgpt] 模型切换未确认：目标「${menu[idx].text}」；菜单原文：${menuText}`);
            return { ok: false, error: "MODEL_SWITCH_UNCONFIRMED", detail: `点击「${menu[idx].text}」后 aria-checked 未变 true`, menu };
        }
        console.log(`[chatgpt] 模型已切换 → 「${menu[idx].text}」（候选 ${model} / ${level}）`);
        return { ok: true, model, level, menu, matchedText: menu[idx].text };
    }

    // 对齐强度：切到强度视图 → 按目标档位点滑轨对应 x 比例 → 回读「第 N 项」
    async _alignChatGptReasoning(page, reasonTarget) {
        if (!(await this._openChatGptModelMenu(page))) {
            console.warn("[chatgpt] 模型弹层未打开，跳过强度设置");
            return false;
        }
        const sliderSel = '[role="menuitem"][aria-label="强度"]';
        if (!(await this._isHittable(page, sliderSel))) {
            // 当前在模型视图 → 点「选择模型」toggle 回强度视图
            const tab = page.locator('[role="menuitem"][aria-label="选择模型"]').first();
            if (await tab.count().catch(() => 0)) {
                await tab.click({ timeout: 4000 }).catch(() => {});
                await page.waitForTimeout(600);
            }
        }
        if (!(await page.locator(sliderSel).count().catch(() => 0))) {
            console.warn("[chatgpt] 未找到强度滑杆，跳过强度设置");
            return false;
        }
        const cur = await this._readReasoningFromMenu(page);
        if (cur === reasonTarget) {
            console.log(`[chatgpt] 强度已是「${reasonTarget}」`);
            return true;
        }
        const track = page.locator(`${sliderSel} span[data-orientation="horizontal"]`).first();
        const box = await track.boundingBox().catch(() => null);
        if (!box || box.width < 20) {
            console.warn("[chatgpt] 强度滑轨尺寸异常，跳过强度设置");
            return false;
        }
        // 只在轨道上点一次（点击位置=设定值），按档位取比例，避开两端 2% 防误触边框
        const ratio = reasonTarget === "高" ? 0.98 : reasonTarget === "中" ? 0.5 : 0.02;
        await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2);
        await page.waitForTimeout(700);
        const after = await this._readReasoningFromMenu(page);
        if (after !== reasonTarget) {
            console.warn(`[chatgpt] 强度设置未确认（期望「${reasonTarget}」，实际「${after || "未知"}」）`);
        }
        return after === reasonTarget;
    }

    // 模型名归一化：小写 + 去全部空白
    _normModelText(s) {
        return (s ?? "").toString().toLowerCase().replace(/\s+/g, "").trim();
    }

    // 是否是「不同模型」的身份标识（出现即不能靠前缀吸收）
    _hasModelIdentityToken(s) {
        const TOKENS = ["sol", "luna", "astra", "terra", "pro", "max", "ultra", "mini"];
        return TOKENS.some((k) => s.includes(k));
    }

    // 模型名匹配（G2 修复，替换原「双向包含」）：
    //   exact   —— 归一化后全等，唯一可信
    //   variant —— 目标不带变体名时补全默认变体（GPT-6 → GPT-6 Sol，Plus/Pro 默认）
    //   suffix  —— 菜单项 = 目标 + 纯修饰后缀（如「高级」「new」），不含身份词
    // 绝不接受「双向包含」：那会让 GPT-6 命中 GPT-6 Astra / Luna / 6.1 且不报错。
    _modelTextMatches(text, target) {
        const t = this._normModelText(text);
        const g = this._normModelText(target);
        if (!t || !g) return null;
        if (t === g) return "exact";
        if (!this._hasModelIdentityToken(g) && t === `${g}sol`) return "variant";
        if (t.startsWith(g)) {
            const rest = t.slice(g.length);
            if (rest && !this._hasModelIdentityToken(rest)) return "suffix";
        }
        return null;
    }

    // 把有序候选链解析成菜单里的目标索引。
    // 返回 { idx, model, level } 或 { error, menu }。多候选命中同一项时 exact 优先；
    // 多个非 exact 命中视为歧义，不猜（猜错会选中 Astra/Luna 且不报错）。
    _resolveModelIndex(menu, chain) {
        for (const cand of chain) {
            const hits = [];
            menu.forEach((m, i) => {
                const level = this._modelTextMatches(m.text, cand);
                if (level) hits.push({ i, level, text: m.text });
            });
            if (!hits.length) continue;
            const exact = hits.filter((h) => h.level === "exact");
            if (exact.length === 1) return { idx: exact[0].i, model: cand, level: "exact" };
            if (hits.length === 1) return { idx: hits[0].i, model: cand, level: hits[0].level };
            return {
                error: `AMBIGUOUS_MODEL`,
                detail: `候选「${cand}」在菜单命中 ${hits.length} 项：[${hits.map((h) => h.text).join(" | ")}]`,
                menu,
            };
        }
        return { error: "MODEL_UNAVAILABLE", detail: `候选链 [${chain.join(" → ")}] 均不在菜单`, menu };
    }

    async sendPromptOnce(prompt, fingerprint, opts) {
        let page = await this.requirePage();
        // 发送前自动对齐 ChatGPT 模型 + 推理档位（非致命：UI 变动时仅告警不阻断流程）
        // opts: { model?, reasoning? } —— 按任务传入对应档位（简单任务走快档，复杂任务走强档）
        await this.ensureChatGptModelAndReasoning(page, opts);
        // 发送前先做健康检查：掉登录 / 人机验证 / 报错弹窗都会让 send 静默失败
        const preHealth = await this.quickHealthCheck().catch(() => ({ ok: true }));
        if (!preHealth.ok) {
            throw new Error(`ChatGPT 页面异常（${preHealth.reason}${preHealth.url ? " @ " + preHealth.url : ""}），未发送 Prompt。请检查登录/人机验证后点「重试失败项」。`);
        }
        // 记录最近一次发送的 prompt，供「生成停滞自动重发」(①) 复用
        this._lastPrompt = prompt;

        const attemptOnce = async () => {
            // 发送前先关闭可能残留的工具菜单/弹窗：enableImageCreation 找不到"创建图片"工具时，
            // 可能遗留一个打开的 composer 工具菜单，遮挡 composer 导致文本写不进（日志多次出现"检测到模态弹窗"）。
            await this._withDeadline(this.dismissOverlays(page), 20_000, "关闭弹窗").catch(() => {});
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(300).catch(() => {});
            const assistantCount = await this._withDeadline(this.assistantMessages(page).count(), CDP_DOM_READ_TIMEOUT_MS, "读取助手消息数");
            const userMessages = page.locator(MSG_USER_SELECTOR);
            const userCount = await this._withDeadline(userMessages.count(), CDP_DOM_READ_TIMEOUT_MS, "读取用户消息数");
            // 健壮写入：清空 → 真实点击聚焦 composer → 插入 → 校验确实写入；失败则重试聚焦+插入。
            // 关键修复：此前仅 el.focus() 后 insertText，Lexical composer 偶发丢失焦点导致文本未写入、
            // 发送按钮长期 disabled，最终 click 超时（"element is not enabled"）。改为真实点击聚焦并校验落字。
            const composerEl = this.composer(page);
            await composerEl.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
            for (let writeAttempt = 0; writeAttempt < 3; writeAttempt += 1) {
                await this.clearComposerText(page);
                // 真实点击让 Lexical composer 获得焦点（模拟用户操作），避免 insertText 落空
                // 每次重试前再关一次可能遮挡 composer 的菜单/弹窗
                await this._withDeadline(this.dismissOverlays(page), 20_000, "关闭弹窗").catch(() => {});
                await page.keyboard.press("Escape").catch(() => {});
                await composerEl.click({ timeout: 5_000 }).catch(() => {});
                const writeResult = await this.insertComposerText(page, prompt);
                // ProseMirror 完整渲染长 Prompt 时，后续 Playwright click 可能排在长任务
                // 之后。已在同一个页面任务内完成提交即可直接进入回复等待。
                if (writeResult?.submitted) {
                    return assistantCount;
                }
                const wrote = await this._withDeadline(page.evaluate((arg) => {
                    const el = document.querySelector(arg.sel);
                    if (!el) return false;
                    const t = (el.textContent || "") + (el.innerText || "");
                    if (t.includes(arg.p.slice(0, Math.min(16, arg.p.length))))
                        return true;
                    // 长 Prompt 可能被空白折叠，长度占比达标同样视为已写入
                    const norm = (v) => (v || "").replace(/\s+/g, "");
                    const wanted = norm(arg.p);
                    return wanted.length > 0 && norm(t).length >= wanted.length * 0.95;
                }, { p: prompt, sel: COMPOSER_SELECTOR }).catch(() => false), CDP_DOM_READ_TIMEOUT_MS, "校验 composer 文本");
                if (wrote)
                    break;
                console.warn(`[chatgpt] composer 文本未写入，第 ${writeAttempt + 1} 次重试聚焦+插入`);
            }
            const composerHasPrompt = await this._withDeadline(composerEl
                .innerText()
                .then((text) => {
                    if (text.includes(prompt.slice(0, Math.min(16, prompt.length))))
                        return true;
                    const norm = (v) => (v || "").replace(/\s+/g, "");
                    const wanted = norm(prompt);
                    return wanted.length > 0 && norm(text).length >= wanted.length * 0.95;
                })
                .catch(() => false), CDP_DOM_READ_TIMEOUT_MS, "读取 composer 文本");
            if (!composerHasPrompt) {
                const error = new Error(`ChatGPT 编辑器未接受 Prompt「${fingerprint}」，已尝试 3 次；请检查页面是否被弹窗遮挡。`);
                error.code = "CHATGPT_COMPOSER_WRITE_FAILED";
                throw error;
            }
            // 先等 send 态就绪（处理上一行仍在生成的 stop 态），再用 waitFor 兜底可见性
            // 超时 60s 太短：批量 row N 刚完成时 row N+1 立即进来，旧 chat 的 stop-button
            // 残留时间偶发 > 60s（尤其 full_listing 走完 MVP4 作图后）；提到 180s 留缓冲。
            await this.waitForSendReady(page, 180_000);
            const sendButton = this.sendButton(page);
            await sendButton.waitFor({ state: "visible", timeout: 5_000 });
            await this._withDeadline(this.dismissOverlays(page), 20_000, "关闭弹窗").catch(() => {});
            // 关键修复：发送前确认按钮已 enabled（composer 确有内容）。否则抛出明确诊断，
            // 避免 playwright 对禁用按钮静默等待 30s 才报 "element is not enabled"。
            const sendEnabled = await this._withDeadline(sendButton.isEnabled().catch(() => false), CDP_DOM_READ_TIMEOUT_MS, "读取发送按钮状态");
            if (!sendEnabled) {
                throw new Error(`ChatGPT 发送按钮处于禁用态（composer 可能为空或被弹窗遮挡），无法发送 Prompt「${fingerprint}」。请检查 ChatGPT 页面是否有弹窗或未进入对话，手动确认 composer 有内容后重试。`);
            }
            await sendButton.click();
            const waitForDispatch = async (timeoutMs) => {
                const deadline = Date.now() + timeoutMs;
                while (Date.now() < deadline) {
                    const nextUserCount = await this._withDeadline(userMessages.count(), CDP_DOM_READ_TIMEOUT_MS, "读取用户消息数");
                    const nextAssistantCount = await this._withDeadline(this.assistantMessages(page).count(), CDP_DOM_READ_TIMEOUT_MS, "读取助手消息数");
                    const stopVisible = await this._withDeadline(this.stopButton(page)
                        .isVisible()
                        .catch(() => false), CDP_DOM_READ_TIMEOUT_MS, "读取 stop 按钮");
                    const composerText = await this._withDeadline(composerEl.innerText().catch(() => ""), CDP_DOM_READ_TIMEOUT_MS, "读取 composer 文本");
                    const latestUserMatches = nextUserCount > userCount &&
                        (await this._withDeadline(userMessages
                            .nth(nextUserCount - 1)
                            .innerText()
                            .then((text) => text.includes(fingerprint))
                            .catch(() => false), CDP_DOM_READ_TIMEOUT_MS, "读取最新用户消息"));
                    // 新版 ChatGPT 有时不再暴露 data-message-author-role；输入框清空
                    // 或首页跳转为会话 URL 都是同等可靠的实际提交信号。
                    if (nextUserCount > userCount ||
                        nextAssistantCount > assistantCount ||
                        stopVisible ||
                        latestUserMatches ||
                        !composerText.trim() ||
                        /^https:\/\/chatgpt\.com\/c\//.test(page.url())) {
                        return assistantCount;
                    }
                    await page.waitForTimeout(500);
                }
                return undefined;
            };
            // ChatGPT 新版 UI 偶发让可见且 enabled 的 SVG 发送按钮 click 无效。
            // 先给标准点击一个短确认窗口；若草稿仍在，直接对同一 Lexical composer
            // 发送 Enter（不重复插入文本），以实际提交信号确认后再继续。
            const clickedResult = await waitForDispatch(4_000);
            if (clickedResult !== undefined) {
                return clickedResult;
            }
            const draftStillPresent = await this._withDeadline(composerEl
                .innerText()
                .then((text) => Boolean(text.trim()))
                .catch(() => false), CDP_DOM_READ_TIMEOUT_MS, "读取 composer 草稿");
            if (draftStillPresent) {
                await composerEl.press("Enter");
            }
            // 延长到 45s（30s 太短，长 Prompt 经常误判）
            const dispatched = await waitForDispatch(45_000);
            if (dispatched !== undefined) {
                return dispatched;
            }
            throw new Error("timeout");
        };

        // 长 Prompt 写入超时时主动断开卡住的 CDP 会话后重连一次；旧的协议调用会随
        // 连接关闭而终止，避免之后异步落入过期 Prompt。
        // 发送成功后同步目标对话 URL：ChatGPT 会把 URL 从首页漂到 /c/<id>，
        // 不记录的话，后续任何重连都可能选中 Chrome 里别的 ChatGPT 标签。
        let composerRecoveryAttempted = false;
        const runWithTargetSync = async () => {
            // 外层安全网：即使内部某个 CDP 调用漏了包装，单次发送也不可能超过该上限。
            const result = await this._withDeadline(attemptOnce(), ATTEMPT_HARD_DEADLINE_MS, "ChatGPT 发送（整体）");
            this.syncTargetChatUrl();
            return result;
        };
        try {
            return await runWithTargetSync();
        }
        catch (error) {
            if (!composerRecoveryAttempted &&
                ["CHATGPT_COMPOSER_WRITE_TIMEOUT", "CHATGPT_COMPOSER_WRITE_FAILED", "CDP_CALL_TIMEOUT"].includes(error?.code)) {
                composerRecoveryAttempted = true;
                console.warn(`[chatgpt] CDP/编辑器异常（${error?.code}），断开并重连后重试：${fingerprint}`);
                await this.resetStuckComposerConnection();
                page = await this.launch();
                await this.ensureChatGptModelAndReasoning(page, opts);
                return await runWithTargetSync();
            }
            if (error.message !== "timeout") {
                throw error;
            }
            // 重试前清理：弹窗 + 健康检查 + 再次清空 composer
            await this._withDeadline(this.dismissOverlays(page), 20_000, "关闭弹窗").catch(() => {});
            const retryHealth = await this.quickHealthCheck().catch(() => ({ ok: true }));
            if (!retryHealth.ok) {
                throw new Error(`ChatGPT 页面异常（${retryHealth.reason}${retryHealth.url ? " @ " + retryHealth.url : ""}），重试未执行。请检查后点「重试失败项」。`);
            }
            try {
                return await runWithTargetSync();
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
                const sequence = await this.readMessageSequence(page);
                let matchedIndex = -1;
                for (let index = sequence.length - 1; index >= 0; index -= 1) {
                    const message = sequence[index];
                    if (message.role !== "user" || !message.text.includes(fingerprint)) {
                        continue;
                    }
                    matchedIndex = index;
                    break;
                }
                if (matchedIndex >= 0) {
                    return this.assistantResponseAfter(sequence, matchedIndex);
                }
                // 兜底：未匹配到 fingerprint 时，若页面已停止生成，直接取最后一条 assistant 回复。
                // ChatGPT 可能折叠/截断用户 Prompt，导致 fingerprint 字符串不在 DOM 中。
                const lastAssistant = sequence.slice().reverse().find((m) => m.role === "assistant" && m.text);
                if (lastAssistant) {
                    console.warn(`[chatgpt] recoverCompletedResponse 未找到 fingerprint，使用最后一条 assistant 回复兜底：${fingerprint}`);
                    return lastAssistant.text;
                }
            } catch {
                // 尝试下一个页面
            }
        }
        return undefined;
    }
    async hasUserPrompt(fingerprint) {
        const page = await this.requirePage();
        const users = page.locator(MSG_USER_SELECTOR);
        const count = await users.count();
        for (let index = count - 1; index >= 0; index -= 1) {
            const text = await users.nth(index).innerText().catch(() => "");
            if (text.includes(fingerprint))
                return true;
        }
        // 兜底：只要页面上存在任意 user 消息，就视为 Prompt 已发送。
        // 避免 ChatGPT 折叠 Prompt 导致 fingerprint 匹配失败，流程重复发送。
        if (count > 0) {
            console.warn(`[chatgpt] hasUserPrompt 未找到 fingerprint，但存在 ${count} 条 user 消息，视为已发送：${fingerprint}`);
            return true;
        }
        return false;
    }
    /**
     * 严格版：仅当某条 user 消息确实包含 fingerprint 时才视为已发送，不做任何兜底。
     * 用于「首跑 / 断点续跑」判断，避免把前一步的回复（或任意 user 消息）误判为「本步 Prompt 已发」，
     * 否则会导致本步真正要发的 Prompt 被跳过（表现为「只做了事实确定，没输出标题/详情页」）。
     */
    async hasUserPromptStrict(fingerprint) {
        const page = await this.requirePage();
        const users = page.locator(MSG_USER_SELECTOR);
        const count = await users.count();
        for (let index = count - 1; index >= 0; index -= 1) {
            const text = await users.nth(index).innerText().catch(() => "");
            if (text.includes(fingerprint))
                return true;
        }
        return false;
    }
    async waitForResponseAfterPrompt(fingerprint, options = {}) {
        const page = await this.requirePage();
        const startedAt = Date.now();
        const shouldPause = typeof options.shouldPause === "function"
            ? options.shouldPause
            : () => false;
        const stoppedWithoutOutputGraceMs = options.stoppedWithoutOutputGraceMs ??
            STOPPED_WITHOUT_OUTPUT_GRACE_MS;
        // 只允许在指纹被 ChatGPT 折叠时，使用「本轮开始后新增」的 assistant 回复兜底。
        // 绝不能把上一阶段最后一条回复误认作本阶段结果。
        const initialSequence = await this.readMessageSequence(page)
            .catch(() => []);
        const initialLastAssistantText = initialSequence
            .slice()
            .reverse()
            .find((message) => message.role === "assistant" && message.text)?.text ?? "";
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
        let stoppedWithoutOutputSince;
        const TEXT_POLL_MS = 25_000;
        try {
            while (Date.now() - startedAt < RESPONSE_WAIT_MS) {
                if (shouldPause()) {
                    const error = new Error(`任务已暂停：等待 ${fingerprint} 的回复时收到暂停请求`);
                    error.code = "WORKFLOW_PAUSED";
                    throw error;
                }
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
                const sequence = await this.readMessageSequence(page);
                let matchedIndex = -1;
                for (let index = sequence.length - 1; index >= 0; index -= 1) {
                    const message = sequence[index];
                    if (message.role !== "user" || !message.text.includes(fingerprint)) {
                        continue;
                    }
                    matchedIndex = index;
                    break;
                }
                if (matchedIndex >= 0) {
                    responseText = this.assistantResponseAfter(sequence, matchedIndex) ?? "";
                }
                else {
                    // 指纹可能被 ChatGPT 折叠/截断。仅接受本轮开始后新出现的 assistant
                    // 回复，防止把 MVP1 等上一阶段结果错误写进本阶段。
                    const lastAssistant = sequence.slice().reverse().find((m) => m.role === "assistant" && m.text);
                    if (lastAssistant && lastAssistant.text !== initialLastAssistantText) {
                        console.warn(`[chatgpt] waitForResponseAfterPrompt 指纹被折叠，使用本轮新增 assistant 回复：${fingerprint}`);
                        responseText = lastAssistant.text;
                    }
                }
            }
            else {
                responseText = lastResponseText;
            }
            if (responseText.length > 0)
                generationObserved = true;
            // ChatGPT 已显示「已停止思考」时，Stop 按钮会消失。如果当前阶段仍无任何
            // assistant 回复，继续等待到 22 分钟没有意义，也会阻塞暂停和断点恢复。
            if (!stopVisible && !responseText) {
                stoppedWithoutOutputSince ??= Date.now();
                if (Date.now() - stoppedWithoutOutputSince >= stoppedWithoutOutputGraceMs) {
                    const error = new Error(`ChatGPT 已停止思考但未返回回复：${fingerprint}`);
                    error.code = "CHATGPT_STOPPED_WITHOUT_OUTPUT";
                    throw error;
                }
            }
            else {
                stoppedWithoutOutputSince = undefined;
            }
            // ② 周期性页面健康检查：检测掉登录 / 人机验证 / 报错弹窗
            if (Date.now() - lastHealthCheck > HEALTH_CHECK_MS) {
                lastHealthCheck = Date.now();
                const health = await this.quickHealthCheck().catch(() => ({ ok: true }));
                if (!health.ok) {
                    await this.clickStopSafely(page);
                    throw new Error(`ChatGPT 页面异常（${health.reason}${health.url ? " @ " + health.url : ""}），已停止等待。请检查登录/人机验证后点击「继续」重新运行本阶段。`);
                }
            }
            // ① 生成停滞检测：stop 仍可见，但回复文本长时间零增长（包括“已开始生成、
            // 却一个字符都没有返回”的页面假死）→ 自动点停止并重发。旧条件要求先读到
            // 一段回复，零输出卡死会一直等到总超时，后台自然无法回传任何结果。
            if (stopVisible && Date.now() - lastGrowthAt > STALL_DETECT_MS) {
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
            // 轮询从 1s 放宽到 2s：配合 messageSequence 轻量化 + 生成中跳文本读取，减少主线程占用，
            // 既能实时感知回复完成（秒级），又显著降低 ChatGPT 页面卡顿。
            lastResponseText = responseText;
            await page.waitForTimeout(2_000);
        }
        throw new Error(`等待已发送 Prompt 的回复超时：${fingerprint}`);
        }
        finally {
            this._waiting = null;
        }
    }
    async insertComposerText(page, prompt) {
        let timeoutId;
        try {
            const result = await Promise.race([
                page.evaluate(async ({ value, chunk, maxAttempts, sel }) => {
                    const editor = document.querySelector(sel);
                    if (!editor) {
                        return { written: false, submitted: false, reason: "找不到 ChatGPT 编辑器" };
                    }
                    // 防呆（2026-10-24）：Canvas/写作块文档编辑器同样带 role="textbox"，
                    // 实测高度可达数千 px。一旦选择器退化命中它，写入会极慢并卡死，
                    // 而下面的校验又从同一个元素读回 → "自证成功"。这里直接拒绝写入，
                    // 让上层重试/报错，而不是静默写错地方。
                    const viewportH = window.innerHeight || 800;
                    const box = editor.getBoundingClientRect();
                    if (box.height > viewportH * 0.7) {
                        return {
                            written: false,
                            submitted: false,
                            reason: `选中的编辑器疑似文档/画布编辑器（高 ${Math.round(box.height)}px，视口 ${viewportH}px），已拒绝写入`,
                        };
                    }
                    editor.focus();
                    // 诊断：页面若存在写作块/文档编辑器（与 composer 同为 role=textbox），
                    // 记录一笔，便于排查"回复落进文档区"这类环境异常；不阻断发送。
                    const docEditorPresent = !!document.querySelector(
                        '[contenteditable="true"][aria-label*="写作"], [contenteditable="true"][aria-label*="Write"]'
                    );
                    if (editor instanceof HTMLTextAreaElement) {
                        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
                        descriptor?.set?.call(editor, value);
                        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
                    }
                    else {
                        // 分块 insertText：ChatGPT 的 Lexical composer 处理换行极慢
                        // （≈300ms/换行），整段一次插入会让 renderer 阻塞上百秒。
                        // 逐块插入并 setTimeout(0) 让出主线程，保证 CDP 仍可通信。
                        for (let offset = 0; offset < value.length; offset += chunk) {
                            document.execCommand("insertText", false, value.slice(offset, offset + chunk));
                            if (offset + chunk < value.length) {
                                await new Promise((resolve) => setTimeout(resolve, 0));
                            }
                        }
                    }
                    const marker = value.slice(0, Math.min(16, value.length));
                    const normalize = (text) => (text || "").replace(/\s+/g, "");
                    const wanted = normalize(value);
                    // 在同一 renderer 任务中等待 React/ProseMirror 启用发送按钮并提交。
                    // 避免长文本渲染后 Playwright 的后续 click 永远排不到执行机会。
                    return new Promise((resolve) => {
                        let attempts = 0;
                        const submit = () => {
                            const text = editor.innerText || editor.textContent || "";
                            // 写入判定同时看 marker 与「去空白长度占比」，避免长 Prompt
                            // 因空白折叠导致前 16 字符匹配失败而误判为未写入。
                            const enough = text.includes(marker) ||
                                (wanted.length > 0 && normalize(text).length >= wanted.length * 0.95);
                            const send = document.querySelector('#composer-submit-button[data-testid="send-button"], button[data-testid="send-button"], button[aria-label="发送"], button[aria-label="Send"], button[aria-label="Send message"]');
                            if (enough && send instanceof HTMLButtonElement && !send.disabled) {
                                send.click();
                                resolve({ written: true, submitted: true, docEditorPresent });
                                return;
                            }
                            attempts += 1;
                            if (attempts >= maxAttempts) {
                                resolve({ written: enough, submitted: false, docEditorPresent, reason: `发送按钮未在 ${Math.round(maxAttempts * 0.05)} 秒内就绪` });
                                return;
                            }
                            window.setTimeout(submit, 50);
                        };
                        window.setTimeout(submit, 0);
                    });
                }, { value: prompt, chunk: COMPOSER_INSERT_CHUNK, maxAttempts: COMPOSER_SUBMIT_MAX_ATTEMPTS, sel: COMPOSER_SELECTOR }),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        const error = new Error(`ChatGPT 编辑器写入超时（>${COMPOSER_INSERT_TIMEOUT_MS / 1000}s）`);
                        error.code = "CHATGPT_COMPOSER_WRITE_TIMEOUT";
                        reject(error);
                    }, COMPOSER_INSERT_TIMEOUT_MS);
                })
            ]);
            if (!result.written) {
                const error = new Error(`ChatGPT 编辑器未接受 Prompt：${result.reason || "未检测到写入内容"}`);
                error.code = "CHATGPT_COMPOSER_WRITE_FAILED";
                throw error;
            }
            console.log(`[chatgpt] composer 写入完成：${prompt.length} 字符，submitted=${result.submitted}`);
            if (result.docEditorPresent) {
                console.warn("[chatgpt] ⚠️ 页面存在写作块/文档编辑器（aria-label 含「写作」）。"
                    + "prompt 已确认只写入对话输入框；但该编辑器会占满正文区，可能干扰回复读取，"
                    + "必要时在 ChatGPT 页面手动关闭它再跑。");
            }
            // 关键：必须回传结果。sendPromptOnce 依赖 submitted 判断是否已在同一 renderer
            // 任务内提交；此前漏了 return，写入成功后反而抛
            // "Cannot read properties of undefined (reading 'submitted')"。
            return result;
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    async clearComposerText(page) {
        return page.evaluate((sel) => {
            const editor = document.querySelector(sel);
            if (!editor) {
                return false;
            }
            // 同 insertComposerText 的防呆：绝不尝试清空文档/画布编辑器（会清掉用户稿件且极慢）
            const viewportH = window.innerHeight || 800;
            if (editor.getBoundingClientRect().height > viewportH * 0.7) {
                return false;
            }
            const current = editor.innerText || editor.textContent || "";
            if (!current.trim()) {
                return true;
            }
            editor.focus();
            if (editor instanceof HTMLTextAreaElement) {
                const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
                descriptor?.set?.call(editor, "");
            }
            else {
                // 不使用 keyboard Delete/Backspace：ProseMirror 在清除上万字符草稿时会
                // 让 CDP 输入调用长期不返回。直接替换 DOM 后派发 input 事件即可同步状态。
                editor.innerHTML = "";
            }
            editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
            return !(editor.innerText || editor.textContent || "").trim();
        }, COMPOSER_SELECTOR);
    }
    async resetStuckComposerConnection() {
        const browser = this.browser;
        this.browser = undefined;
        this.context = undefined;
        this.page = undefined;
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
    /**
     * 把当前对话 URL 记为目标，供后续重连回到同一标签。
     * ChatGPT 发送 Prompt 后 URL 会从首页漂到 /c/<id>，不记下来，
     * 中途一旦重连就会按 `includes("chatgpt.com")` 选中别的标签。
     * 注意：Project（项目）内的对话 URL 是 /g/<project-id>/c/<chat-id>，
     * 必须一并识别，否则项目对话永远记不上目标。
     */
    syncTargetChatUrl() {
        const url = this.page && !this.page.isClosed() ? this.page.url() : undefined;
        if (url && /^https:\/\/chatgpt\.com\/(c\/|g\/[^/]+\/c\/)/.test(url)) {
            this._targetChatUrl = url;
        }
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
    // CDP 协议握手偶发卡死（浏览器目标多/某标签 DOM 过大时），加超时 + 重试自愈。
    async connectToChrome() {
        let connected = false;
        let lastConnErr = null;
        for (let attempt = 1; attempt <= 3 && !connected; attempt += 1) {
            try {
                if (this.browser) { await this.browser.close().catch(() => {}); this.browser = null; }
                this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`, { timeout: 60000 });
                connected = true;
            } catch (e) {
                lastConnErr = e;
                if (this.browser) { await this.browser.close().catch(() => {}); this.browser = null; }
                console.warn(`[chatgpt] CDP 连接第 ${attempt}/3 次失败：${e?.message || e}`);
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }
        if (!connected) throw new Error(`Chrome CDP 连接失败（已重试 3 次）：${lastConnErr && lastConnErr.message}`);
        // 注册断连事件：浏览器崩溃/被回收时即时失效，避免 quickHealthCheck 等后续操作误判健康
        this._setupDisconnectHandler();
        this.context = this.browser.contexts()[0];
        if (!this.context) {
            throw new Error("Chrome 调试连接没有可用浏览器上下文");
        }
        return this.context;
    }
    /** 注册 browser 断连回调，使断连即时失效（下次 launch() 会重连） */
    _setupDisconnectHandler() {
        if (!this.browser) return;
        // 首次调用时 this._disconnectHandler 还是 undefined；off(event, undefined) 会抛 TypeError，
        // 因此只有在 handler 已是函数时才解绑。重复注册也只会保留最新一份。
        if (typeof this._disconnectHandler === "function") {
            this.browser.off("disconnected", this._disconnectHandler);
        }
        this._disconnectHandler = () => {
            console.warn("[chatgpt] Chrome CDP 断连，已自动标记为不可用（下次操作将自动重连）");
            this.browser = null;
            this.page = null;
            this.context = undefined;
        };
        this.browser.on("disconnected", this._disconnectHandler);
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
            // 关掉 Chrome 顶部「不受支持的命令行标记 / 正受自动化控制」信息条，
            // 否则它会盖住工作台页面顶部、遮挡进度浮窗
            "--disable-infobars",
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
        // 统一走 COMPOSER_SELECTOR（见文件头注释）：新版页面有两个 contenteditable[role=textbox]，
        // 旧的裸 `div[contenteditable="true"][role="textbox"]` 会先命中「开始写作」文档编辑器。
        return page.locator(COMPOSER_SELECTOR).first();
    }
    sendButton(page) {
        // 2026-10 新版 UI 去掉了 composer-submit-button / data-testid="send-button"，
        // 发送按钮只剩 aria-label（中文「发送」/ 英文「Send」）。旧选择器保留在前，兼容 A/B 回滚。
        return page
            .locator('button#composer-submit-button[data-testid="send-button"], button[aria-label="发送提示"][data-testid="send-button"], button[aria-label="Send prompt"][data-testid="send-button"], button[data-testid="send-button"], button[aria-label="发送"], button[aria-label="Send"], button[aria-label="Send message"]')
            .first();
    }
    // 兼容旧的 send-button 选择器（仅用于错误信息回显，避免误中 stop-button）
    _sendButtonStrict(page) {
        return page
            .locator('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="发送提示"], button[aria-label="发送"], button[aria-label="Send"], button[aria-label="Send message"]')
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
            const stopVisible = await this._withDeadline(stop.isVisible().catch(() => false), CDP_DOM_READ_TIMEOUT_MS, "读取 stop 按钮");
            const sendVisible = await this._withDeadline(send.isVisible().catch(() => false), CDP_DOM_READ_TIMEOUT_MS, "读取发送按钮");
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
        const stopStillVisible = await this._withDeadline(stop.isVisible().catch(() => false), CDP_DOM_READ_TIMEOUT_MS, "读取 stop 按钮").catch(() => false);
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
            .locator('button[data-testid="stop-button"], button[aria-label*="Stop generating"], button[aria-label*="停止生成"], button[aria-label="停止"], button[aria-label="Stop"]')
            .first();
    }
    assistantMessages(page) {
        return page.locator(MSG_ASSISTANT_SELECTOR);
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
        let page;
        try {
            page = await this.requirePage();
        } catch {
            return { ok: false, reason: "浏览器未连接或页面不可用" };
        }
        let url;
        try {
            url = page.url();
        } catch {
            return { ok: false, reason: "浏览器已断连" };
        }
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
                    // 不再使用 textContent：它会把块级元素之间的渲染换行吞掉，导致 Listing/SEO
                    // 等 Markdown 输出变成一坨无格式文本。也不用 innerText：它会触发同步布局，
                    // 长作图会话重排极慢。改为轻量 DOM 遍历，在段落/标题/列表/表格等语义块级
                    // 边界插入换行，同时排除按钮/链接等 UI 控件文字。
                    function extractMessageText(node) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            return node.textContent || "";
                        }
                        if (node.nodeType !== Node.ELEMENT_NODE) {
                            return "";
                        }
                        const element = node;
                        const tag = element.tagName;
                        // 排除消息气泡里的操作按钮（编辑、复制、点赞等），避免它们的文字混进正文
                        if (tag === "BUTTON" || tag === "A" || element.getAttribute("role") === "button" || element.getAttribute("role") === "link") {
                            return "";
                        }
                        if (tag === "BR") {
                            return "\n";
                        }
                        const blockTags = new Set([
                            "P", "H1", "H2", "H3", "H4", "H5", "H6",
                            "LI", "TR", "TD", "TH", "PRE", "BLOCKQUOTE", "HR"
                        ]);
                        const isBlock = blockTags.has(tag);
                        let text = isBlock ? "\n" : "";
                        for (const child of element.childNodes) {
                            text += extractMessageText(child);
                        }
                        if (isBlock) {
                            text += "\n";
                        }
                        return text;
                    }
                    const els = elements.slice(-20);
                    return els.map((element) => {
                        const raw = extractMessageText(element);
                        // 合并连续 3+ 换行为一个空行，避免 DOM 嵌套产生过多空行
                        const text = raw.replace(/\n{3,}/g, "\n\n").trim();
                        return {
                            role: element.getAttribute("data-message-author-role") ??
                                element.getAttribute("data-conversation-role") ??
                                (element.getAttribute("data-user-message-bubble") ? "user" : null),
                            text
                        };
                    });
                });
            }
            catch (error) {
                lastError = error;
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes("Execution context was destroyed") ||
                    message.includes("Frame was detached") ||
                    message.includes("Target closed") ||
                    message.includes("Navigating") ||
                    message.includes("browser is not connected")) {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    continue;
                }
                throw error;
            }
        }
        throw lastError ?? new Error("无法读取 ChatGPT 消息序列");
    }
    // ===== 2026-10 新版 UI 消息读取（turn-based）=====
    // 新版把「一轮」整体包在 [data-talvt-turn-state] 里：用户气泡 data-user-message-bubble，
    // 助手侧只有 sr-only 的 H4[data-conversation-role=assistant]，正文在其祖父容器。
    // 因此不能再用单一选择器读写，改为逐轮解析：用户取气泡文本，助手取祖父块并剥掉「ChatGPT 说：」。
    async messageSequenceFromTurns(page) {
        return page.evaluate(() => {
            const turns = [...document.querySelectorAll("[data-talvt-turn-state], [data-chatgpt-agent-turn-start]")];
            const seen = new Set();
            const out = [];
            const clean = (text) =>
                String(text || "")
                    .replace(/^\s*(你说|You said)\s*[:：]\s*/i, "")
                    .replace(/^\s*(ChatGPT)\s*(说|said)\s*[:：]\s*/i, "")
                    .trim();
            for (const turn of turns) {
                if (seen.has(turn))
                    continue;
                seen.add(turn);
                const userEl = turn.querySelector('[data-user-message-bubble="true"]');
                if (userEl) {
                    const text = clean(userEl.innerText);
                    if (text)
                        out.push({ role: "user", text });
                }
                const label = turn.querySelector('[data-conversation-role="assistant"]');
                if (label) {
                    const block = label.parentElement?.parentElement ?? label.parentElement;
                    const text = clean(block?.innerText);
                    if (text)
                        out.push({ role: "assistant", text });
                }
            }
            return out;
        });
    }
    async readMessageSequence(page) {
        const legacyPresent = await page
            .locator('[data-message-author-role="user"], [data-message-author-role="assistant"]')
            .count()
            .catch(() => 0);
        if (legacyPresent > 0) {
            return this.messageSequence(page.locator(MSG_ALL_SELECTOR));
        }
        return this.messageSequenceFromTurns(page);
    }
    assistantResponseAfter(sequence, userIndex) {
        const texts = sequence
            .slice(userIndex + 1)
            .filter((candidate) => candidate.role === "assistant" && candidate.text)
            .map((candidate) => candidate.text);
        return texts.length ? texts.join("\n\n").trim() : undefined;
    }
    generatedImages(page) {
        // 选择器见模块级 GENERATED_IMAGE_SELECTOR（多语言 / 多版本兼容）。
        return page.locator(GENERATED_IMAGE_SELECTOR);
    }
    /**
     * 返回最后一张已渲染生成图的 src（blob 唯一）。DOM 虚拟化/懒加载会让图片数量抖动，
     * 因此"是否出现新图"必须按 src 判断，不能按数量（2026-10-24 真机 Image 3/4 卡死根因）。
     */
    async generatedImageLastSrc(page) {
        const p = page ?? (await this.requirePage());
        return p.evaluate((sel) => {
            const imgs = Array.from(document.querySelectorAll(sel));
            if (!imgs.length) {
                return "";
            }
            const el = imgs[imgs.length - 1];
            return el.currentSrc || el.src || "";
        }, GENERATED_IMAGE_SELECTOR).catch(() => "");
    }
    async saveGeneratedImage(image, outputPath) {
        const waitPage = await this.requirePage();
        // ChatGPT 生成图常先出现占位缩略图，再异步加载高清资源；
        // 直接读 naturalWidth 会命中占位（<300）而误报「无法读取高清图片资源」。
        // 这里轮询等待图片真正加载完成后再读。
        let metadata = null;
        for (let attempt = 0; attempt < 25; attempt += 1) {
            metadata = await image.evaluate((element) => ({
                src: element.currentSrc || element.src,
                width: element.naturalWidth,
                height: element.naturalHeight
            })).catch(() => null);
            if (metadata && metadata.src && metadata.width >= 300 && metadata.height >= 300)
                break;
            await waitPage.waitForTimeout(1_000);
        }
        if (!metadata || !metadata.src || metadata.width < 300 || metadata.height < 300) {
            throw new Error("已检测到生成图片，但无法读取高清图片资源（等待 25s 后仍无高清图加载）");
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
            'button[data-testid*="composer-plus"]',
            'button[data-testid*="composer-attach"]',
            'button[aria-label*="paperclip"]'
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
        let signals;
        while (Date.now() < deadline) {
            signals = await this.composerAttachmentSignals(page);
            // A composer-local remove control or a composer-local preview root maps to
            // one file.  Do not count broad page-level "attachment" test ids: message
            // history and hidden tool DOM can otherwise produce a false positive.
            const maxCount = this.attachmentCountFromSignals(signals);
            if (maxCount >= expected) {
                console.log(`[chatgpt] 确认 ${maxCount} 个 composer 附件（期望 ${expected}）：${JSON.stringify(signals)}`);
                return maxCount;
            }
            await page.waitForTimeout(1_000);
        }
        // 不能把 setInputFiles 成功当成页面已附加成功。若没有可见缩略图，发送的
        // 产品识别 Prompt 会变成无图 Prompt，后续的事实、调研与生图全部失去依据。
        signals = await this.composerAttachmentSignals(page);
        const visibleCount = this.attachmentCountFromSignals(signals);
        console.warn(`[chatgpt] composer 附件校验未通过（期望 ${expected}，可见 ${visibleCount}，诊断 ${JSON.stringify(signals)}），阻止发送 Prompt。`);
        return visibleCount;
    }
    attachmentCountFromSignals(signals) {
        return Math.max(signals.removeControls, signals.previewRoots, signals.previewImages);
    }
    async composerAttachmentCount(page) {
        const signals = await this.composerAttachmentSignals(page);
        return this.attachmentCountFromSignals(signals);
    }
    async composerAttachmentSignals(page) {
        return await page.evaluate((sel) => {
            const composer = document.querySelector(sel);
            if (!composer)
                return { scope: "missing-composer", removeControls: 0, previewRoots: 0, previewImages: 0 };
            let scope = composer.closest('form');
            // ChatGPT occasionally renders the composer outside a form.  Use its
            // nearest ancestor containing an image upload input, never document-wide.
            if (!scope) {
                let ancestor = composer.parentElement;
                while (ancestor && ancestor !== document.body) {
                    if (ancestor.querySelector('input[type="file"]')) {
                        scope = ancestor;
                        break;
                    }
                    ancestor = ancestor.parentElement;
                }
            }
            if (!scope)
                return { scope: "missing-composer-scope", removeControls: 0, previewRoots: 0, previewImages: 0 };
            const visible = (element) => {
                const style = window.getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            };
            const count = (selector) => Array.from(scope.querySelectorAll(selector)).filter(visible).length;
            return {
                scope: scope.tagName.toLowerCase(),
                removeControls: count('button[aria-label*="Remove file"], button[aria-label*="Remove attachment"], button[aria-label*="移除文件"], button[aria-label*="移除附件"], button[aria-label^="移除"], button[aria-label^="Remove"]'),
                previewRoots: count('[data-testid="file-preview"], [data-testid="image-preview"], [data-testid="attachment-preview"], .attachment-preview, .file-thumbnail, button:has(img)'),
                // 当前 ChatGPT 中文版常把缩略图直接放在 composer 的 button 里，
                // 没有 file-preview data-testid。scope 已限制在 composer 周边，直接计数
                // 可见图片可覆盖该版本，同时不会把对话历史中的图片误算进去。
                previewImages: count('.composer-attachments img, [data-testid="file-preview"] img, [data-testid="image-preview"] img, button:has(img) img, img[src^="data:image/"], img[src^="blob:"]')
            };
        }, COMPOSER_SELECTOR).catch(() => ({ scope: "signal-error", removeControls: 0, previewRoots: 0, previewImages: 0 }));
    }
}
//# sourceMappingURL=chatgpt-adapter.js.map
