import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { OUTPUT_DIR, PLANNING_COMPLETION_PROMPT, PRODUCT_FACT_FILE, PRODUCT_FACT_PROMPT_FINGERPRINT, PRODUCT_IMAGES_DIR, PRODUCT_ROOT, TEST_PROMPT, singleImageCommand } from "./config.js";
import { normalizeDianxiaomiFacts } from "./dianxiaomi-facts.js";
import { scanProductImages } from "./image-files.js";
import { extractImagePrompt, readPrompt, validatePromptPack } from "./prompt-files.js";
import { ProductVisualAssetsService } from "./product-visual-assets-service.js";
const SEO_KEYWORDS_FINGERPRINT = "Google Ads SEO Keyword Research Prompt";
const LISTING_CONTENT_FINGERPRINT = "AliExpress Listing Commercial Delivery Prompt";
const LEGACY_LISTING_CONTENT_FINGERPRINT = "AliExpress 通用 Listing 标题 属性词 轻详情页生成 Prompt";
const LISTING_CONTENT_FINGERPRINTS = [
    LISTING_CONTENT_FINGERPRINT,
    LEGACY_LISTING_CONTENT_FINGERPRINT
];
// 上品流程 → 店小秘 桥接（Plan B）：MVP5 后把 Listing 资料整理成 product-facts.json 用的 fingerprint。
const PRODUCT_FACTS_STRUCTURE_FINGERPRINT = "Dianxiaomi Product Facts Structure Prompt";
// 桥接整理 prompt（不改动原 MVP1/MVP5 prompt，单独追加）。
const PRODUCT_FACTS_STRUCTURE_PROMPT = `你现在是「店小秘 ERP 上品资料整理员」。
下面给你两份已经生成的商品文本：
A) 产品事实提取（MVP1 回复）
B) SEO / Listing 文案（MVP5 交付）

请综合这两份文本，输出**一个且仅一个** JSON 代码块（用 \`\`\`json 包裹），符合以下形状：

{
  "title": { "zh": string, "en": string },
  "category": string,
  "brand": string | null,
  "material": string | null,
  "origin": { "country": string, "province": string },
  "keyAttributes": Array<{ "name": string, "value": string }>,
  "variants": {
    "colors": string[],
    "sizes": string[],
    "defaultPrice": string,
    "defaultStock": string,
    "defaultWeight": string
  },
  "unit": string | null,
  "weight": number | null,
  "dimensionsCm": { "length": number, "width": number, "height": number },
  "description": { "pc": string, "mobile": string },
  "hsCode": string,
  "sourceUrl": string,
  "mainKeyword": string
}

规则：
- 只输出 JSON 代码块，不要任何解释性文字、不要前后缀。
- 字段缺失就留空字符串 / 空数组 / null，绝对不要编造。
- **title.en 必须取自 B) Listing 文案中「3.1 算法标题 Clean Title」下的完整 Clean Title 一行**，不要自行概括或重写。如果 Clean Title 不存在，再退而使用 B) 中的其它英文标题。
- **description.pc 与 description.mobile 必须优先取自 B) Listing 文案中「3.2 AEO 结构化五点描述 Bullet Points And Q And A」下的完整内容（包含 Basic Information、Core Selling Points、Q And A、WARM NOTE，保留其 markdown 结构）**。若该段落不存在，再退而组合 B) 中的其它属性与卖点段落。
- images.main 不要填（后端会自动注入当前产品图文件名）。
- 颜色 / 尺寸 / 价格 / 重量尽量从文本推断；推断不出就留空数组 / 空字符串。`;
// 从 MVP5 Listing 文案中提取 Clean Title（3.1 算法标题 Clean Title）。
// 匹配「3.1 算法标题 Clean Title」后的第一行非空文本。
function extractCleanTitle(listingText) {
    if (!listingText) return "";
    const match = listingText.match(/3\.1\s*[\s\S]*?算法标题\s*Clean Title[\s\S]*?\n\s*\n?\s*([^\n]+?)\s*\n/i);
    if (match && match[1]) {
        const title = match[1].trim();
        if (title.length >= 10) return title;
    }
    // 退化：找任何 "Clean Title" 后面的第一行
    const fallback = listingText.match(/Clean Title[\s\S]*?\n\s*\n?\s*([^\n]+?)\s*\n/i);
    if (fallback && fallback[1]) {
        const title = fallback[1].trim();
        if (title.length >= 10) return title;
    }
    return "";
}

// 从 MVP5 Listing 文案中提取商品详情页内容（3.3 商品详情页内容 Product Detail Page）。
// 从该标题后开始，到下一个 "3.x" 标题或 "Step " 或文件结束。
function extractProductDetailPage(listingText) {
    if (!listingText) return "";
    const startMatch = listingText.match(/3\.3\s*[\s\S]*?(?:商品详情页内容|Product Detail Page)[\s\S]*?\n/i);
    if (!startMatch) return "";
    const startIndex = startMatch.index + startMatch[0].length;
    const remainder = listingText.slice(startIndex);
    // 遇到下一个 3.x 标题或 Step x | 结束
    const endMatch = remainder.match(/\n\s*(?:3\.\d+\s+|Step\s+\d+\s*\||#{1,6}\s+3\.\d+|#{1,6}\s+Step\s+\d+)/i);
    const endIndex = endMatch ? endMatch.index : remainder.length;
    return remainder.slice(0, endIndex).trim();
}

// 从 MVP5 Listing 文案中提取 AEO 结构化五点描述（3.2 小节），
// 含 Basic Information / Core Selling Points / Q And A / WARM NOTE。
function extractAeoSection(listingText) {
    if (!listingText) return "";
    // 兼容空格差异：AEO结构化 / AEO 结构化；Bullet Points And Q&A / Bullet Points And Q And A
    const startMatch = listingText.match(/3\.2\s*[\s\S]*?(?:AEO\s*结构化五点描述|Bullet Points And Q(?:\s*&\s*|\s+And\s+)A|Bullet Points And Q And A)[\s\S]*?\n/i);
    if (!startMatch) return "";
    const startIndex = startMatch.index + startMatch[0].length;
    const remainder = listingText.slice(startIndex);
    const endMatch = remainder.match(/\n\s*(?:3\.\d+\s+|Step\s+\d+\s*\||#{1,6}\s+3\.\d+|#{1,6}\s+Step\s+\d+)/i);
    const endIndex = endMatch ? endMatch.index : remainder.length;
    return remainder.slice(0, endIndex).trim();
}

function extractJsonBlock(text) {
    if (!text)
        throw new Error("AI 未返回内容");
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced
        ? fenced[1]
        : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    if (!candidate || !candidate.trim())
        throw new Error("未在 AI 回复中找到 JSON");
    return candidate.trim();
}
function buildProductFactPrompt(state) {
    const objective = state.objectiveInfo?.trim();
    if (!objective) {
        return TEST_PROMPT;
    }
    return `${TEST_PROMPT}

# 用户补充客观信息
用户已手动补充以下客观信息，请作为商品事实提取的重要参考。若补充内容与图片可见事实冲突，请以图片事实为准并标注冲突；若补充内容未在图片中展示，请纳入事实底稿并标注来源为“用户补充”。

${objective}`;
}
export function standardAutoStep(state) {
    if (state.completedPhase === "MVP5")
        return "complete";
    if (!state.completedPhase)
        return "start";
    if (state.completedPhase === "MVP1") {
        if (state.standardWorkflowGoal === "seo_content_only") {
            return state.researchCompleted ? "seo" : "research";
        }
        return "planning";
    }
    if (state.completedPhase === "MVP3")
        return "images";
    return "seo";
}
export function isSeoContentReady(state) {
    return state.standardWorkflowGoal === "seo_content_only"
        ? state.completedPhase === "MVP1" && Boolean(state.researchCompleted)
        : state.completedPhase === "MVP4" &&
            (state.generatedImageNumbers ?? []).length === 10;
}
export class AutomationService {
    store;
    adapters;
    visualAssets;
    constructor(store, adapters, visualAssets = new ProductVisualAssetsService()) {
        this.store = store;
        this.adapters = adapters;
        this.visualAssets = visualAssets;
    }
    get ai() {
        return this.adapters[this.store.get().provider];
    }
    async enableWebSearchIfAvailable(context) {
        try {
            await this.ai.enableWebSearch();
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            await this.store.update({
                message: `${context}：未能自动启用网页搜索，已降级为直接发送 Prompt。原因：${detail}`
            });
        }
    }
    async recoverCompletedResponseForFingerprints(fingerprints) {
        for (const fingerprint of fingerprints) {
            const response = await this.ai.recoverCompletedResponse(fingerprint);
            if (response)
                return response;
        }
        return undefined;
    }
    async hasUserPromptForFingerprints(fingerprints) {
        for (const fingerprint of fingerprints) {
            if (await this.ai.hasUserPrompt(fingerprint))
                return true;
        }
        return false;
    }
    async waitForResponseAfterFingerprints(fingerprints) {
        const startedAt = Date.now();
        let stableText = "";
        let stableSince;
        while (Date.now() - startedAt < 10 * 60 * 1000) {
            const response = await this.recoverCompletedResponseForFingerprints(fingerprints);
            if (response) {
                if (response !== stableText) {
                    stableText = response;
                    stableSince = Date.now();
                }
                else if (stableSince && Date.now() - stableSince >= 3_000) {
                    return response;
                }
            }
            else {
                stableSince = undefined;
            }
            await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        throw new Error(`等待已发送 Prompt 的回复超时：${fingerprints.join(" / ")}`);
    }
    async selectStandardWorkflowGoal(goal) {
        const state = this.store.get();
        if (state.workflowMode !== "standard_listing") {
            throw new Error("仅标准 Listing 模式可以选择此任务目标");
        }
        if (state.running || state.autoRun) {
            throw new Error("流程运行中，不能切换任务目标");
        }
        if (state.chatUrl || state.completedPhase) {
            throw new Error("当前商品已开始，不能切换任务目标");
        }
        return this.store.update({
            standardWorkflowGoal: goal,
            message: goal === "seo_content_only"
                ? "已选择仅 SEO 与商品文案：将跳过视觉规划和图片生成"
                : "已选择完整 Listing 流程",
            error: undefined
        });
    }
    async selectProvider(provider) {
        const state = this.store.get();
        if (state.running || state.autoRun) {
            throw new Error("流程运行中，不能切换 AI 引擎");
        }
        if (state.provider === provider)
            return state;
        await this.store.update({
            provider,
            browserStarted: false,
            chatUrl: undefined,
            stage: "READY_FOR_LOGIN",
            error: undefined,
            message: `已切换到 ${this.providerName(provider)}，正在准备迁移商品上下文…`
        });
        if (!state.chatUrl) {
            return this.store.get();
        }
        try {
            const adapter = this.adapters[provider];
            await adapter.launch();
            const readiness = await adapter.checkReady();
            if (!readiness.ready) {
                return this.store.update({
                    browserStarted: true,
                    message: `请先登录 ${this.providerName(provider)}，登录后点击“重新检查连接”`,
                    error: readiness.status === "verification_required"
                        ? `${this.providerName(provider)} 正在要求真人验证`
                        : undefined
                });
            }
            await this.migrateCurrentProduct(adapter, state);
            return this.store.get();
        }
        catch (error) {
            return this.fail(error);
        }
    }
    async launchBrowser() {
        const provider = this.store.get().provider;
        await this.store.update({
            stage: "READY_FOR_LOGIN",
            message: `正在启动 ${this.providerName(provider)}…`,
            error: undefined
        });
        try {
            const page = await this.ai.launch();
            const readiness = await this.ai.checkReady();
            return this.store.update({
                browserStarted: true,
                chatUrl: this.isConversationUrl(provider, page.url())
                    ? page.url()
                    : this.store.get().chatUrl,
                message: this.readinessMessage(readiness.status, provider),
                error: readiness.status === "verification_required"
                    ? `${this.providerName(provider)} 正在要求真人验证。请在打开的普通 Chrome 中手动完成，然后点击“重新检查”。`
                    : undefined
            });
        }
        catch (error) {
            return this.fail(error);
        }
    }
    async runAll(shouldContinue = () => true) {
        const initial = this.store.get();
        if (initial.running || initial.autoRun) {
            throw new Error("当前已有任务正在运行");
        }
        await this.store.update({
            autoRun: true,
            pauseRequested: false,
            error: undefined,
            message: "一键流程已启动，正在判断当前断点…"
        });
        try {
            while (true) {
                const state = this.store.get();
                if (!shouldContinue() || this.store.get().pauseRequested) {
                    await this.store.update({
                        stage: "PAUSED",
                        running: false,
                        autoRun: false,
                        pauseRequested: false,
                        error: undefined,
                        interruptedStage: state.stage,
                        message: "任务已在安全节点暂停，可从当前断点继续"
                    });
                    return;
                }
                const seoOnly = state.standardWorkflowGoal === "seo_content_only";
                const nextStep = standardAutoStep(state);
                if (nextStep === "complete") {
                    await this.store.update({
                        stage: "COMPLETED",
                        running: false,
                        error: undefined,
                        interruptedStage: undefined,
                        message: seoOnly
                            ? "SEO 与商品文案增强流程已完成并保存"
                            : "一键流程已完成：图片、SEO 词库和 Listing 文案均已保存"
                    });
                    return;
                }
                if (nextStep === "start") {
                    await this.start();
                    if (this.store.get().completedPhase !== "MVP1")
                        return;
                    continue;
                }
                if (nextStep === "research") {
                    await this.continueThroughResearch();
                    if (!this.store.get().researchCompleted)
                        return;
                    continue;
                }
                if (nextStep === "planning") {
                    await this.continueThroughPlanning();
                    if (this.store.get().completedPhase !== "MVP3")
                        return;
                    continue;
                }
                if (nextStep === "images") {
                    await this.generateImages(shouldContinue);
                    if (this.store.get().completedPhase !== "MVP4")
                        return;
                    continue;
                }
                if (nextStep === "seo") {
                    await this.generateSeoListingContent(shouldContinue);
                    if (this.store.get().completedPhase !== "MVP5")
                        return;
                    continue;
                }
            }
        }
        catch (error) {
            await this.fail(error);
        }
        finally {
            await this.store.update({ autoRun: false });
        }
    }
    async recheck() {
        try {
            const readiness = await this.ai.checkReady();
            const provider = this.store.get().provider;
            const state = this.store.get();
            if (readiness.ready &&
                state.completedPhase &&
                !this.isConversationUrl(provider, state.chatUrl ?? "")) {
                await this.migrateCurrentProduct(this.ai, state);
                return this.store.get();
            }
            return this.store.update({
                browserStarted: true,
                chatUrl: this.isConversationUrl(provider, readiness.url)
                    ? readiness.url
                    : this.store.get().chatUrl,
                stage: "READY_FOR_LOGIN",
                message: this.readinessMessage(readiness.status, provider),
                error: readiness.status === "verification_required"
                    ? `请在普通 Chrome 中完成 ${this.providerName(provider)} 人机验证；程序不会尝试绕过验证。`
                    : undefined
            });
        }
        catch (error) {
            return this.fail(error);
        }
    }
    async start() {
        if (this.store.get().running) {
            throw new Error("当前已有任务正在运行");
        }
        await this.store.update({
            stage: "VALIDATING_INPUT",
            message: "正在检查产品图片…",
            running: true,
            error: undefined,
            interruptedStage: undefined,
            responseText: undefined,
            researchText: undefined,
            planningText: undefined,
            seoKeywordText: undefined,
            listingContentText: undefined,
            researchCompleted: false,
            promptPackValid: undefined,
            completedPhase: undefined,
            currentImageNumber: undefined,
            generatedImageNumbers: [],
            outputFiles: [],
            startedAt: new Date().toISOString()
        });
        try {
            const images = await scanProductImages();
            if (images.length === 0) {
                throw new Error("产品图为空，请先选择文件夹导入图片");
            }
            await this.store.update({
                imageCount: images.length,
                imageNames: images.map((image) => image.name),
                stage: "CREATING_CHAT",
                message: `已找到 ${images.length} 张去重图片，正在新建 ${this.providerName(this.store.get().provider)} 对话…`
            });
            const readiness = await this.ai.checkReady();
            if (!readiness.ready) {
                throw new Error(`${this.providerName(this.store.get().provider)} 未登录或输入框不可用`);
            }
            const chatUrl = await this.ai.createBlankChat();
            await this.store.update({
                chatUrl,
                stage: "UPLOADING_IMAGES",
                message: `正在上传 ${images.length} 张产品图片…`
            });
            await this.ai.uploadImages(images.map((image) => image.path));
            await this.store.update({
                stage: "SENDING_PROMPT",
                message: "图片上传完成，正在发送测试 Prompt…"
            });
            await this.ai.sendPromptOnce(buildProductFactPrompt(this.store.get()), PRODUCT_FACT_PROMPT_FINGERPRINT);
            await this.store.update({
                chatUrl: this.ai.currentUrl(),
                stage: "WAITING_FOR_RESPONSE",
                message: `Prompt 已发送，正在等待 ${this.providerName(this.store.get().provider)} 回复完成…`
            });
            const responseText = await this.ai.waitForResponseAfterPrompt(PRODUCT_FACT_PROMPT_FINGERPRINT);
            await this.store.update({
                stage: "COMPLETED",
                message: "MVP 1 已完成",
                running: false,
                chatUrl: this.ai.currentUrl(),
                responseText,
                error: undefined,
                interruptedStage: undefined,
                completedPhase: "MVP1"
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async continueThroughPlanning() {
        if (this.store.get().running) {
            throw new Error("当前已有任务正在运行");
        }
        const existing = this.store.get();
        if (!existing.chatUrl) {
            throw new Error("尚未完成产品识别，请先在「产品素材」页点击「开始产品识别」建立商品对话");
        }
        await this.store.update({
            running: true,
            pauseRequested: false,
            error: undefined,
            interruptedStage: undefined,
            promptPackValid: undefined,
            message: "正在恢复 MVP 1 商品对话…"
        });
        try {
            const planningPromptTemplate = await readPrompt("planning");
            await this.ai.openChat(existing.chatUrl);
            const researchText = await this.ensureResearch(existing);
            await this.store.update({
                researchText,
                researchCompleted: true,
                stage: "SENDING_PLANNING",
                message: "市场调研完成，正在发送视觉规划 Prompt…"
            });
            const planningPrompt = planningPromptTemplate.replace("{{CHROME_AI_REPORT}}", researchText);
            let planningText = existing.planningText ??
                (await this.ai.recoverCompletedResponse("Single Image Prompt Pack"));
            if (!planningText) {
                if (await this.ai.hasUserPrompt("Single Image Prompt Pack")) {
                    await this.store.update({
                        stage: "WAITING_FOR_PLANNING",
                        message: "检测到视觉规划 Prompt 已发送，正在从断点等待回复…"
                    });
                    planningText = await this.ai.waitForResponseAfterPrompt("Single Image Prompt Pack");
                }
                else {
                    await this.ai.sendPromptOnce(planningPrompt, "Single Image Prompt Pack");
                    await this.store.update({
                        stage: "WAITING_FOR_PLANNING",
                        message: "视觉规划已发送，正在等待 Image 1–10 Prompt Pack…"
                    });
                    planningText = await this.ai.waitForResponseAfterPrompt("Single Image Prompt Pack");
                }
            }
            else {
                await this.store.update({
                    message: "检测到视觉规划已完成，正在从断点校验 Prompt Pack…"
                });
            }
            await this.store.update({
                planningText,
                stage: "VALIDATING_PROMPT_PACK",
                message: "正在校验 Image 01–10 Prompt 标记…"
            });
            let validation = validatePromptPack(planningText);
            if (!validation.valid) {
                const recoveredCompletion = await this.ai.recoverCompletedResponse("视觉规划自动补全指令");
                if (recoveredCompletion) {
                    planningText = recoveredCompletion;
                }
                else if (await this.ai.hasUserPrompt("视觉规划自动补全指令")) {
                    await this.store.update({
                        stage: "WAITING_FOR_PLANNING",
                        message: "自动补全指令已发送，正在从断点等待完整 Prompt Pack…"
                    });
                    planningText = await this.ai.waitForResponseAfterPrompt("视觉规划自动补全指令");
                }
                else {
                    await this.store.update({
                        stage: "SENDING_PLANNING",
                        message: "检测到 ChatGPT 停在信息确认，正在自动要求其基于图片和调研完成规划…"
                    });
                    await this.ai.sendPromptOnce(PLANNING_COMPLETION_PROMPT, "视觉规划自动补全指令");
                    await this.store.update({
                        stage: "WAITING_FOR_PLANNING",
                        message: "自动补全指令已发送，正在等待完整 Prompt Pack…"
                    });
                    planningText = await this.ai.waitForResponseAfterPrompt("视觉规划自动补全指令");
                }
                validation = validatePromptPack(planningText);
                await this.store.update({
                    planningText,
                    stage: "VALIDATING_PROMPT_PACK",
                    message: "正在校验自动补全后的 Image 01–10 Prompt 标记…"
                });
            }
            if (!validation.valid) {
                console.warn("[planning] Prompt Pack 校验未通过，已按用户设置跳过 QC 拦截，缺失：", validation.missing.join(", "));
            }
            await this.store.update({
                stage: "COMPLETED",
                message: validation.valid ? "MVP 2–3 已完成，Prompt Pack 校验通过" : "MVP 2–3 已完成，Prompt Pack QC 已跳过",
                running: false,
                promptPackValid: true,
                completedPhase: "MVP3",
                error: undefined,
                interruptedStage: undefined,
                chatUrl: this.ai.currentUrl()
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async continueThroughResearch() {
        if (this.store.get().running) {
            throw new Error("当前已有任务正在运行");
        }
        const existing = this.store.get();
        if (!existing.chatUrl || existing.completedPhase !== "MVP1") {
            throw new Error("请先完成产品识别");
        }
        await this.store.update({
            running: true,
            pauseRequested: false,
            error: undefined,
            interruptedStage: undefined,
            message: "正在恢复商品对话并准备联网市场调研…"
        });
        try {
            await this.ai.openChat(existing.chatUrl);
            const researchText = await this.ensureResearch(existing);
            await this.store.update({
                stage: "PAUSED",
                running: false,
                researchText,
                researchCompleted: true,
                chatUrl: this.ai.currentUrl(),
                error: undefined,
                interruptedStage: undefined,
                message: "联网市场调研与 VOC 已完成，可以生成 SEO 与商品文案"
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async generateImages(shouldContinue = () => true) {
        if (this.store.get().running) {
            throw new Error("当前已有任务正在运行");
        }
        const existing = this.store.get();
        if (existing.completedPhase !== "MVP3" ||
            !existing.planningText ||
            !existing.chatUrl) {
            throw new Error("Prompt Pack 尚未准备完成，请先完成 MVP 2–3");
        }
        const generated = new Set(existing.generatedImageNumbers ?? []);
        await this.store.update({
            running: true,
            pauseRequested: false,
            error: undefined,
            interruptedStage: undefined,
            generatedImageNumbers: [...generated],
            outputFiles: existing.outputFiles ?? [],
            message: "正在恢复商品对话并准备逐图生成…"
        });
        try {
            await this.ai.openChat(existing.chatUrl);
            for (let imageNumber = 1; imageNumber <= 10; imageNumber += 1) {
                if (generated.has(imageNumber))
                    continue;
                if (!shouldContinue() || this.store.get().pauseRequested) {
                    await this.store.update({
                        stage: "PAUSED",
                        running: false,
                        autoRun: false,
                        pauseRequested: false,
                        interruptedStage: "GENERATING_IMAGES",
                        currentImageNumber: undefined,
                        error: undefined,
                        message: `任务已安全暂停，已完成 ${generated.size}/10 张图片`
                    });
                    return;
                }
                const fileName = `Image_${String(imageNumber).padStart(2, "0")}.jpg`;
                const outputPath = path.join(OUTPUT_DIR, fileName);
                const interruptedCurrentImage = existing.currentImageNumber === imageNumber;
                if (interruptedCurrentImage &&
                    (await this.ai.saveLatestCompletedGeneratedImage(outputPath, generated.size))) {
                    generated.add(imageNumber);
                    const recoveredFiles = [
                        ...(this.store.get().outputFiles ?? []),
                        fileName
                    ];
                    await this.store.update({
                        stage: "GENERATING_IMAGES",
                        generatedImageNumbers: [...generated].sort((a, b) => a - b),
                        outputFiles: [...new Set(recoveredFiles)],
                        message: `Image ${imageNumber} 已从当前页面恢复并保存`
                    });
                    continue;
                }
                if (interruptedCurrentImage &&
                    existing.stage !== "FAILED" &&
                    (await this.ai.hasUserPrompt(`请生成 Image ${imageNumber}`))) {
                    await this.store.update({
                        stage: "DOWNLOADING_IMAGE",
                        currentImageNumber: imageNumber,
                        message: `Image ${imageNumber} 指令已发送，正在从断点等待并保存…`
                    });
                    await this.ai.waitForGeneratedImageAndDownload(generated.size, outputPath);
                    generated.add(imageNumber);
                    const resumedFiles = [
                        ...(this.store.get().outputFiles ?? []),
                        fileName
                    ];
                    await this.store.update({
                        stage: "GENERATING_IMAGES",
                        generatedImageNumbers: [...generated].sort((a, b) => a - b),
                        outputFiles: [...new Set(resumedFiles)],
                        message: `Image ${imageNumber} 已从断点恢复并下载`
                    });
                    continue;
                }
                const imagePrompt = extractImagePrompt(existing.planningText, imageNumber);
                await this.store.update({
                    stage: "GENERATING_IMAGES",
                    currentImageNumber: imageNumber,
                    message: `正在切换创建图片模式并生成 Image ${imageNumber}…`
                });
                await this.ai.enableImageCreation();
                const generationInput = await this.visualAssets.validateGenerationInput({
                    image_number: imageNumber,
                    image_prompt: imagePrompt,
                    prompt_version: "single-image-v1"
                });
                await this.ai.uploadImages(generationInput.reference_image_paths);
                const previousGeneratedImageCount = await this.ai.generatedImageCount();
                const command = singleImageCommand(imageNumber, imagePrompt);
                await this.ai.sendPromptOnce(command, `请生成 Image ${imageNumber}`);
                await this.store.update({
                    stage: "DOWNLOADING_IMAGE",
                    message: `Image ${imageNumber} 已派发，正在等待生成并下载…`
                });
                await this.ai.waitForGeneratedImageAndDownload(previousGeneratedImageCount, outputPath);
                generated.add(imageNumber);
                const outputFiles = [...(this.store.get().outputFiles ?? []), fileName];
                await this.store.update({
                    stage: "GENERATING_IMAGES",
                    generatedImageNumbers: [...generated].sort((a, b) => a - b),
                    outputFiles: [...new Set(outputFiles)],
                    message: `Image ${imageNumber} 已下载`
                });
                if (this.store.get().pauseRequested) {
                    await this.store.update({
                        stage: "PAUSED",
                        running: false,
                        autoRun: false,
                        pauseRequested: false,
                        interruptedStage: "GENERATING_IMAGES",
                        currentImageNumber: undefined,
                        error: undefined,
                        message: `当前图片已保存，任务已安全暂停（${generated.size}/10）`
                    });
                    return;
                }
            }
            await this.store.update({
                stage: "COMPLETED",
                running: false,
                completedPhase: "MVP4",
                currentImageNumber: undefined,
                error: undefined,
                interruptedStage: undefined,
                message: "MVP 4 已完成，Image 1–10 已全部下载"
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async generateSeoListingContent(shouldContinue = () => true) {
        if (this.store.get().running) {
            throw new Error("当前已有任务正在运行");
        }
        const existing = this.store.get();
        const seoOnly = existing.standardWorkflowGoal === "seo_content_only";
        const readyForSeo = isSeoContentReady(existing);
        if (!readyForSeo || !existing.chatUrl) {
            throw new Error(seoOnly
                ? "请先完成产品识别和联网市场调研"
                : "请先完成 MVP 4 的 Image 1–10 生成");
        }
        await this.store.update({
            running: true,
            pauseRequested: false,
            error: undefined,
            interruptedStage: undefined,
            message: "正在恢复商品对话并准备 SEO 关键词研究…"
        });
        try {
            const seoPromptTemplate = await readPrompt("seoKeywords");
            const listingPromptTemplate = await readPrompt("listingContent");
            await this.ai.openChat(existing.chatUrl);
            const seoPrompt = seoOnly
                ? `${seoPromptTemplate}

## 本商品已完成的联网市场调研与 VOC
<<<MARKET_RESEARCH_REPORT_START>>>
${existing.researchText ?? ""}
<<<MARKET_RESEARCH_REPORT_END>>>

请明确基于以上产品事实、市场调研和 VOC 生成关键词，不依赖视觉规划或生图结果。`
                : seoPromptTemplate;
            let seoKeywordText = existing.seoKeywordText ??
                (await this.ai.recoverCompletedResponse(SEO_KEYWORDS_FINGERPRINT));
            if (!seoKeywordText) {
                if (await this.ai.hasUserPrompt(SEO_KEYWORDS_FINGERPRINT)) {
                    await this.store.update({
                        stage: "WAITING_FOR_SEO_KEYWORDS",
                        message: "SEO Prompt 已发送，正在从断点等待完整词库…"
                    });
                    seoKeywordText = await this.ai.waitForResponseAfterPrompt(SEO_KEYWORDS_FINGERPRINT);
                }
                else {
                    await this.store.update({
                        stage: "SENDING_SEO_KEYWORDS",
                        message: "正在启用网页搜索并发送 SEO 关键词 Prompt…"
                    });
                    await this.enableWebSearchIfAvailable("SEO 关键词");
                    await this.ai.sendPromptOnce(seoPrompt, SEO_KEYWORDS_FINGERPRINT);
                    await this.store.update({
                        stage: "WAITING_FOR_SEO_KEYWORDS",
                        message: "关键词研究已发送，正在等待完整词库…"
                    });
                    seoKeywordText = await this.ai.waitForResponseAfterPrompt(SEO_KEYWORDS_FINGERPRINT);
                }
            }
            await this.store.update({
                seoKeywordText,
                stage: "SENDING_LISTING_CONTENT",
                message: "SEO 词库已完成，正在生成标题、属性词和详情页…"
            });
            if (!shouldContinue() || this.store.get().pauseRequested) {
                await this.store.update({
                    stage: "PAUSED",
                    running: false,
                    autoRun: false,
                    pauseRequested: false,
                    interruptedStage: "SENDING_LISTING_CONTENT",
                    error: undefined,
                    message: "队列已暂停，SEO 词库已保留，尚未发送 Listing 文案 Prompt"
                });
                return;
            }
            const listingPrompt = [
                LISTING_CONTENT_FINGERPRINT,
                listingPromptTemplate.replace("{{SEO_KEYWORD_REPORT}}", seoKeywordText)
            ].join("\n\n");
            let listingContentText = existing.listingContentText ??
                (await this.recoverCompletedResponseForFingerprints(LISTING_CONTENT_FINGERPRINTS));
            if (!listingContentText) {
                if (await this.hasUserPromptForFingerprints(LISTING_CONTENT_FINGERPRINTS)) {
                    await this.store.update({
                        stage: "WAITING_FOR_LISTING_CONTENT",
                        message: "Listing Prompt 已发送，正在从断点等待完整内容…"
                    });
                    listingContentText = await this.waitForResponseAfterFingerprints(LISTING_CONTENT_FINGERPRINTS);
                }
                else {
                    await this.ai.sendPromptOnce(listingPrompt, LISTING_CONTENT_FINGERPRINT);
                    await this.store.update({
                        stage: "WAITING_FOR_LISTING_CONTENT",
                        message: "Listing 文案 Prompt 已发送，正在等待完整交付内容…"
                    });
                    listingContentText = await this.ai.waitForResponseAfterPrompt(LISTING_CONTENT_FINGERPRINT);
                }
            }
            await this.store.update({
                listingContentText,
                stage: "SAVING_LISTING_CONTENT",
                message: "文案已生成，正在保存 SEO 词库和 Listing 内容…"
            });
            await mkdir(OUTPUT_DIR, { recursive: true });
            await Promise.all([
                writeFile(path.join(OUTPUT_DIR, "03_SEO_KEYWORDS.md"), `${seoKeywordText.trim()}\n`, "utf8"),
                writeFile(path.join(OUTPUT_DIR, "04_LISTING_CONTENT.md"), `${listingContentText.trim()}\n`, "utf8")
            ]);
            await this.store.update({
                stage: "COMPLETED",
                running: false,
                completedPhase: "MVP5",
                error: undefined,
                interruptedStage: undefined,
                message: seoOnly
                    ? "SEO 与商品文案增强流程已完成并保存"
                    : "MVP 5 已完成，SEO 词库和 Listing 文案已保存"
            });
            // 桥接（Plan B，非致命）：把 Listing 资料整理成 当前产品/product-facts.json，
            // 供后续「上架店小秘」复用（不改动原 MVP1/MVP5 prompt）。
            try {
                await this.generateProductFactsFile(existing, listingContentText);
            }
            catch (factsError) {
                console.error("[product-facts] 整理 product-facts.json 失败（非致命，不影响 MVP5 完成）:", factsError);
            }
        }
        catch (error) {
            await this.fail(error);
        }
    }
    /**
     * 桥接（Plan B）：MVP5 完成后，把产品事实(MVP1 responseText) + Listing 文案(MVP5 文本)
     * 发给 AI 整理成 normalizeDianxiaomiFacts 形状的 JSON，注入真实产品图文件名后写入
     * 当前产品/product-facts.json。不改动原 prompt。失败抛错（调用方已做非致命保护）。
     * @param {object} state 当前 run-state 快照（需含 responseText）
     * @param {string} listingContentText MVP5 交付的 Listing 文案
     */
    async generateProductFactsFile(state, listingContentText) {
        const factText = state?.responseText || "";
        if (!factText && !listingContentText) {
            console.warn("[product-facts] 无产品事实与 Listing 文案，跳过整理");
            return null;
        }
        const prompt = [
            PRODUCT_FACTS_STRUCTURE_FINGERPRINT,
            "",
            PRODUCT_FACTS_STRUCTURE_PROMPT,
            "",
            "## A) 产品事实提取（MVP1）",
            "<<<FACTS_START>>>",
            factText,
            "<<<FACTS_END>>>",
            "",
            "## B) SEO / Listing 文案（MVP5）",
            "<<<LISTING_START>>>",
            listingContentText,
            "<<<LISTING_END>>>",
            "",
            "请按上述要求输出符合形状的 JSON 代码块。"
        ].join("\n");
        await this.ai.sendPromptOnce(prompt, PRODUCT_FACTS_STRUCTURE_FINGERPRINT);
        await this.store.update({
            stage: "BUILDING_PRODUCT_FACTS",
            message: "正在把 Listing 资料整理成 product-facts.json…"
        });
        const responseText = await this.ai.waitForResponseAfterPrompt(PRODUCT_FACTS_STRUCTURE_FINGERPRINT);
        const parsed = JSON.parse(extractJsonBlock(responseText));
        const facts = normalizeDianxiaomiFacts(parsed);
        // 强制使用 MVP5 Listing 里的 Clean Title 与 AEO 结构化五点描述（AI 可能未严格按 prompt 提取）
        const cleanTitle = extractCleanTitle(listingContentText);
        if (cleanTitle) {
            facts.title.en = cleanTitle;
            facts.title.zh = facts.title.zh || "";
        }
        const aeoSection = extractAeoSection(listingContentText);
        if (aeoSection) {
            facts.description.pc = aeoSection;
            facts.description.mobile = aeoSection;
        }
        // 主图优先使用 MVP4 AI 生成的 Listing 图（output/Image_01.png ...），而非原始 1688 产品图。
        // 这样店小秘上品主图和详情页插图才是「系统做的图」；无生成图时才回退到 scanProductImages。
        try {
            const outFiles = await readdir(OUTPUT_DIR).catch(() => []);
            const generated = outFiles
                .filter((f) => /^Image_\d+\.(png|jpg|jpeg|webp)$/i.test(f))
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                .slice(0, 6);
            if (generated.length) {
                await mkdir(PRODUCT_IMAGES_DIR, { recursive: true });
                for (const f of generated) {
                    const src = path.join(OUTPUT_DIR, f);
                    const dst = path.join(PRODUCT_IMAGES_DIR, f);
                    try {
                        await copyFile(src, dst);
                    }
                    catch (_e) {
                        // 已存在或不可复制则继续
                    }
                }
                facts.images.main = generated;
            }
            else {
                const images = await scanProductImages();
                if (Array.isArray(images) && images.length) {
                    facts.images.main = images.map((img) => img.name);
                }
            }
        }
        catch (_e) {
            // 无图或目录异常则保持空数组，引用上架时由 checkDianxiaomiFactsReady 拦截提示
        }
        await mkdir(PRODUCT_ROOT, { recursive: true });
        const target = path.join(PRODUCT_ROOT, "product-facts.json");
        await writeFile(target, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
        // 同步镜像到根目录 product-facts.json：店小秘 manual 面板的 upload-images / save-variants
        // 与「上架」(dxReferenceApply，不带 facts) 都读此文件。若不镜像，桥接产物与面板事实文件
        // 两处不一致，会导致不带 facts 的引用上架误用旧类目/旧标题（已踩坑：ruTie 旧档覆盖箱包新档）。
        try {
            await writeFile(PRODUCT_FACT_FILE, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
        }
        catch (mirrorErr) {
            console.warn("[product-facts] 镜像到根目录 product-facts.json 失败（非致命）:", mirrorErr);
        }
        await this.store.update({
            productFactsReady: true,
            productFactsPath: target,
            message: "MVP 5 已完成，product-facts.json 已生成（可上架店小秘）"
        });
        return facts;
    }
    async syncFromChatGpt() {
        const before = this.store.get();
        if (!before.chatUrl) {
            throw new Error("当前没有可同步的 AI 商品对话");
        }
        await this.ai.openChat(before.chatUrl);
        const known = before.generatedImageNumbers ?? [];
        const recovered = await this.ai.recoverCompletedGeneratedImages(OUTPUT_DIR, known);
        const recoveredFiles = recovered.map((number) => `Image_${String(number).padStart(2, "0")}.jpg`);
        const added = recovered.filter((number) => !known.includes(number));
        const reconciledInterruptedImage = !before.running &&
            (added.length > 0 ||
                (before.currentImageNumber !== undefined &&
                    recovered.includes(before.currentImageNumber)));
        if (recovered.length === 10 && !before.running) {
            return this.store.update({
                stage: "COMPLETED",
                completedPhase: "MVP4",
                currentImageNumber: undefined,
                generatedImageNumbers: recovered,
                outputFiles: recoveredFiles,
                error: undefined,
                interruptedStage: undefined,
                message: "手动同步完成，Image 1–10 已全部保存"
            });
        }
        return this.store.update({
            stage: reconciledInterruptedImage ? "PAUSED" : before.stage,
            currentImageNumber: reconciledInterruptedImage ? undefined : before.currentImageNumber,
            generatedImageNumbers: recovered,
            outputFiles: recoveredFiles,
            error: reconciledInterruptedImage ? undefined : before.error,
            interruptedStage: reconciledInterruptedImage
                ? "GENERATING_IMAGES"
                : before.interruptedStage,
            message: added.length > 0
                ? before.running
                    ? `手动同步成功，补收 Image ${added.join("、")}；自动流程将继续`
                    : `手动同步成功，补收 Image ${added.join("、")}；请点击继续 MVP 4`
                : reconciledInterruptedImage
                    ? `状态同步完成，后台已保存 ${recovered.length}/10 张图片；请点击继续 MVP 4`
                    : `已检查 ${this.providerName(before.provider)}，后台当前已保存 ${recovered.length}/10 张图片`
        });
    }
    async fail(error) {
        const message = error instanceof Error ? error.message : String(error);
        const current = this.store.get();
        const recoverable = /Target page, context or browser has been closed|专用 Chrome 尚未启动|connectOverCDP|ECONNREFUSED|Chrome.*关闭|浏览器.*关闭/i.test(message);
        const currentUrl = this.ai.currentUrl();
        return this.store.update({
            stage: recoverable ? "PAUSED" : "FAILED",
            interruptedStage: current.stage,
            message: recoverable
                ? "流程已暂停，重新打开 Chrome 后可从断点继续"
                : "流程已停止，可修复后从断点继续",
            running: false,
            chatUrl: currentUrl && this.isConversationUrl(current.provider, currentUrl)
                ? currentUrl
                : this.isConversationUrl(current.provider, current.chatUrl ?? "")
                    ? current.chatUrl
                    : undefined,
            error: message
        });
    }
    async resume() {
        try {
            let state = this.store.get();
            if (state.running)
                throw new Error("当前已有任务正在运行");
            if (!this.isConversationUrl(state.provider, state.chatUrl ?? "")) {
                const page = await this.ai.launch();
                const recoveredUrl = page.url();
                if (!this.isConversationUrl(state.provider, recoveredUrl)) {
                    const readiness = await this.ai.checkReady();
                    if (!readiness.ready) {
                        throw new Error(`请先登录 ${this.providerName(state.provider)}，然后重新连接并继续`);
                    }
                    await this.migrateCurrentProduct(this.ai, state);
                    state = this.store.get();
                }
                else {
                    state = await this.store.update({
                        chatUrl: recoveredUrl,
                        message: "已从专用 Chrome 恢复原商品对话地址"
                    });
                }
            }
            if (state.standardWorkflowGoal === "seo_content_only" &&
                state.completedPhase === "MVP1") {
                if (state.researchCompleted) {
                    await this.generateSeoListingContent();
                }
                else {
                    await this.continueThroughResearch();
                }
                return;
            }
            if (state.completedPhase === "MVP3" &&
                (state.generatedImageNumbers ?? []).length < 10) {
                await this.generateImages();
                return;
            }
            if (state.completedPhase === "MVP4") {
                await this.generateSeoListingContent();
                return;
            }
            if (state.completedPhase === "MVP1") {
                await this.continueThroughPlanning();
                return;
            }
            const nextStep = standardAutoStep(state);
            if (nextStep !== "complete") {
                await this.runAll();
                return;
            }
            await this.store.update({
                stage: "COMPLETED",
                running: false,
                error: undefined,
                message: state.standardWorkflowGoal === "seo_content_only"
                    ? "SEO 与商品文案增强流程已完成并保存"
                    : "一键流程已完成：图片、SEO 词库和 Listing 文案均已保存"
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async ensureResearch(existing) {
        const fingerprint = "Chrome AI Top 10 Listing Visual Audit Prompt";
        const researchPrompt = await readPrompt("research");
        let researchText = existing.researchText ??
            (await this.ai.recoverCompletedResponse(fingerprint));
        if (researchText) {
            await this.store.update({
                researchText,
                researchCompleted: true,
                message: "检测到市场调研已完成，正在从断点继续…"
            });
            return researchText;
        }
        await this.store.update({
            stage: "WAITING_FOR_RESEARCH",
            message: "正在检查已发送的市场调研 Prompt…"
        });
        if (await this.ai.hasUserPrompt(fingerprint)) {
            researchText = await this.ai.waitForResponseAfterPrompt(fingerprint);
        }
        else {
            await this.store.update({
                stage: "SENDING_RESEARCH",
                message: "正在启用网页搜索并发送市场调研 Prompt…"
            });
            await this.enableWebSearchIfAvailable("市场调研");
            await this.ai.sendPromptOnce(researchPrompt, fingerprint);
            await this.store.update({
                stage: "WAITING_FOR_RESEARCH",
                message: "市场调研已发送，正在等待完整回复…"
            });
            researchText = await this.ai.waitForResponseAfterPrompt(fingerprint);
        }
        await this.store.update({
            researchText,
            researchCompleted: true
        });
        return researchText;
    }
    readinessMessage(status, provider = this.store.get().provider) {
        const name = this.providerName(provider);
        if (status === "ready")
            return `${name} 已登录，可以开始产品识别`;
        if (status === "verification_required") {
            return `${name} 检测到真人验证，请在普通 Chrome 中手动完成`;
        }
        return `请在打开的普通 Chrome 中登录 ${name}，然后点击“重新检查”`;
    }
    providerName(provider) {
        return provider === "gemini" ? "Gemini" : "ChatGPT";
    }
    isConversationUrl(provider, url) {
        return provider === "gemini"
            ? /^https:\/\/gemini\.google\.com\/app\/.+/.test(url)
            : /^https:\/\/chatgpt\.com\/c\/.+/.test(url);
    }
    async migrateCurrentProduct(adapter, previousState) {
        const images = await scanProductImages();
        if (images.length === 0) {
            throw new Error("无法迁移：当前产品图片为空");
        }
        await adapter.createBlankChat();
        await this.store.update({
            browserStarted: true,
            chatUrl: undefined,
            stage: "UPLOADING_IMAGES",
            running: true,
            error: undefined,
            message: `正在向 ${this.providerName(this.store.get().provider)} 重新上传产品图片…`
        });
        await adapter.uploadImages(images.map((image) => image.path));
        if (!previousState.completedPhase) {
            await this.store.update({
                stage: "SENDING_PROMPT",
                message: `图片迁移完成，正在由 ${this.providerName(this.store.get().provider)} 重新建立产品事实…`
            });
            await adapter.sendPromptOnce(TEST_PROMPT, PRODUCT_FACT_PROMPT_FINGERPRINT);
            const responseText = await adapter.waitForResponseAfterPrompt(PRODUCT_FACT_PROMPT_FINGERPRINT);
            await this.store.update({
                stage: "PAUSED",
                chatUrl: this.validCurrentConversationUrl(adapter),
                responseText,
                completedPhase: "MVP1",
                running: false,
                error: undefined,
                interruptedStage: "SENDING_RESEARCH",
                message: `已切换到 ${this.providerName(this.store.get().provider)} 并重新完成产品识别，可继续市场调研`
            });
            return;
        }
        const context = [
            "# AI 引擎切换交接",
            "",
            "请接管当前商品后续任务。上传图片仍是商品视觉事实的最高优先级来源。",
            "不得改变商品结构，不得把竞品属性写成当前商品事实。",
            previousState.responseText
                ? `\n## 已完成的产品事实\n${previousState.responseText}`
                : "",
            previousState.researchText
                ? `\n## 已完成的市场调研\n${previousState.researchText}`
                : "",
            previousState.planningText
                ? `\n## 已完成的视觉规划\n${previousState.planningText}`
                : "",
            "\n只回复：已接收商品上下文，可以继续。"
        ]
            .filter(Boolean)
            .join("\n");
        await adapter.sendPromptOnce(context, "# AI 引擎切换交接");
        await adapter.waitForResponseAfterPrompt("# AI 引擎切换交接");
        await this.store.update({
            stage: "PAUSED",
            chatUrl: this.validCurrentConversationUrl(adapter),
            running: false,
            error: undefined,
            interruptedStage: previousState.interruptedStage ?? previousState.stage,
            message: `已切换到 ${this.providerName(this.store.get().provider)} 并完成上下文迁移，可继续剩余流程`
        });
    }
    validCurrentConversationUrl(adapter) {
        const url = adapter.currentUrl();
        return url && this.isConversationUrl(this.store.get().provider, url)
            ? url
            : undefined;
    }
}
//# sourceMappingURL=automation-service.js.map