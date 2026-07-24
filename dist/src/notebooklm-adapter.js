import { chromium } from "playwright-core";
import { CHROME_DEBUG_PORT, NOTEBOOKLM_URL } from "./config.js";
const RESPONSE_WAIT_MS = 10 * 60_000;
export class NotebookLmAdapter {
    browser;
    context;
    page;
    async open() {
        if (this.page && !this.page.isClosed()) {
            await this.page.bringToFront();
            return this.page;
        }
        this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);
        this.context = this.browser.contexts()[0];
        if (!this.context)
            throw new Error("Chrome 没有可用浏览器上下文");
        this.page =
            this.context.pages().find((page) => page.url().startsWith(NOTEBOOKLM_URL)) ?? (await this.context.newPage());
        if (!this.page.url().startsWith(NOTEBOOKLM_URL)) {
            await this.page.goto(NOTEBOOKLM_URL, {
                waitUntil: "domcontentloaded",
                timeout: 60_000
            });
        }
        await this.composer().waitFor({ state: "visible", timeout: 30_000 });
        await this.page.bringToFront();
        return this.page;
    }
    async sendOnce(prompt, fingerprint) {
        await this.open();
        const recovered = await this.recover(fingerprint);
        if (recovered)
            return recovered;
        const page = this.requirePage();
        const before = await this.answers().count();
        const composer = this.composer();
        await composer.fill(prompt);
        const enteredText = await this.composerText(composer);
        if (!enteredText.includes(fingerprint)) {
            throw new Error("NotebookLM 输入框未成功写入当前任务");
        }
        let submit = await this.firstActionable([
            'button[aria-label="提交"]',
            'button[aria-label="发送"]',
            'button[aria-label="Send"]',
            'button[aria-label="Submit"]',
            'button[type="submit"]',
            "button.query-box-submit-button"
        ]);
        if (!submit) {
            // NotebookLM's Angular composer occasionally needs keyboard-style input
            // events before the send button becomes enabled.
            await composer.fill("");
            await composer.type(prompt, { delay: 0 });
            await page.waitForTimeout(500);
            submit = await this.firstActionable([
                'button[aria-label="提交"]',
                'button[aria-label="发送"]',
                'button[aria-label="Send"]',
                'button[aria-label="Submit"]',
                'button[type="submit"]',
                "button.query-box-submit-button"
            ]);
        }
        if (!submit) {
            throw new Error("NotebookLM 发送按钮仍不可用，请检查页面登录状态或输入框是否可正常提问");
        }
        await submit.click();
        await this.waitForPromptSubmission(fingerprint);
        return this.waitForAnswer(before, fingerprint);
    }
    async recover(fingerprint) {
        await this.open();
        const matchingPrompts = this.userMessages().filter({ hasText: fingerprint });
        if ((await matchingPrompts.count()) === 0)
            return undefined;
        const answers = this.answers();
        const count = await answers.count();
        if (count === 0)
            return undefined;
        const text = (await answers.nth(count - 1).innerText().catch(() => "")).trim();
        return text || undefined;
    }
    async scanForMarkedAnswer(startMarker, endMarker) {
        // Scan ALL answers from newest to oldest, return the first one containing both markers.
        await this.open();
        const answers = this.answers();
        const count = await answers.count();
        for (let i = count - 1; i >= 0; i--) {
            const text = (await answers.nth(i).innerText().catch(() => "")).trim();
            if (text && text.includes(startMarker) && text.includes(endMarker))
                return text;
        }
        return undefined;
    }
    async waitForAnswer(previousCount, fingerprint) {
        const deadline = Date.now() + RESPONSE_WAIT_MS;
        let stable = "";
        let stableSince = 0;
        while (Date.now() < deadline) {
            const answers = this.answers();
            const count = await answers.count();
            if (count > previousCount) {
                const text = (await answers.nth(count - 1).innerText().catch(() => "")).trim();
                if (text && text !== stable) {
                    stable = text;
                    stableSince = Date.now();
                }
                else if (text && Date.now() - stableSince >= 3_000) {
                    return text;
                }
            }
            await this.requirePage().waitForTimeout(1_000);
        }
        throw new Error(`等待 NotebookLM 回复超时：${fingerprint}`);
    }
    composer() {
        return this.requirePage()
            .locator([
            'textarea[aria-label="查询框"]',
            'textarea[aria-label="Ask"]',
            'textarea[aria-label*="提问"]',
            'textarea[placeholder="提问或创作内容"]',
            'textarea[placeholder*="Ask"]',
            "textarea.query-box-input",
            '[contenteditable="true"][role="textbox"]'
        ].join(", "))
            .first();
    }
    answers() {
        return this.requirePage().locator([
            "mat-card.to-user-message-card-content",
            '[data-message-author-role="assistant"]',
            ".assistant-message",
            ".response-container"
        ].join(", "));
    }
    userMessages() {
        return this.requirePage().locator([
            "mat-card.from-user-message-card-content",
            ".from-user-message-card-content",
            '[data-message-author-role="user"]',
            ".user-message"
        ].join(", "));
    }
    async firstActionable(selectors) {
        const page = this.requirePage();
        for (const selector of selectors) {
            const candidates = page.locator(selector);
            const count = await candidates.count();
            for (let index = 0; index < count; index += 1) {
                const candidate = candidates.nth(index);
                const visible = await candidate.isVisible().catch(() => false);
                const enabled = await candidate.isEnabled().catch(() => false);
                if (visible && enabled)
                    return candidate;
            }
        }
        return undefined;
    }
    async waitForPromptSubmission(fingerprint) {
        const page = this.requirePage();
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
            const composerText = await this.composerText(this.composer());
            const sentPromptCount = await this.userMessages()
                .filter({ hasText: fingerprint })
                .count();
            if (!composerText.includes(fingerprint) && sentPromptCount > 0) {
                return;
            }
            await page.waitForTimeout(500);
        }
        throw new Error("NotebookLM 未确认发送成功，流程已暂停且不会自动重复提交");
    }
    async composerText(composer) {
        return composer
            .evaluate((element) => {
            if ("value" in element) {
                return String(element.value ?? "");
            }
            return element.textContent ?? "";
        })
            .catch(() => "");
    }
    requirePage() {
        if (!this.page || this.page.isClosed()) {
            throw new Error("NotebookLM 页面尚未打开");
        }
        return this.page;
    }
}
//# sourceMappingURL=notebooklm-adapter.js.map