import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { OUTPUT_DIR, PLANNING_COMPLETION_PROMPT, PRODUCT_FACT_PROMPT_FINGERPRINT, TEST_PROMPT, singleImageCommand } from "./config.js";
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
            await this.ai.sendPromptOnce(TEST_PROMPT, PRODUCT_FACT_PROMPT_FINGERPRINT);
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
            throw new Error("没有 MVP 1 商品对话，请先完成 MVP 1");
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
                throw new Error(`Prompt Pack 不完整，缺少：${validation.missing.join(", ")}`);
            }
            await this.store.update({
                stage: "COMPLETED",
                message: "MVP 2–3 已完成，Prompt Pack 校验通过",
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
            !existing.promptPackValid ||
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
                const fileName = `Image_${String(imageNumber).padStart(2, "0")}.png`;
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
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async syncFromChatGpt() {
        const before = this.store.get();
        if (!before.chatUrl) {
            throw new Error("当前没有可同步的 AI 商品对话");
        }
        await this.ai.openChat(before.chatUrl);
        const known = before.generatedImageNumbers ?? [];
        const recovered = await this.ai.recoverCompletedGeneratedImages(OUTPUT_DIR, known);
        const recoveredFiles = recovered.map((number) => `Image_${String(number).padStart(2, "0")}.png`);
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