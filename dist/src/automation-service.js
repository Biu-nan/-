import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { OUTPUT_DIR, PLANNING_COMPLETION_PROMPT, PRODUCT_FACT_FILE, PRODUCT_FACT_PROMPT_FINGERPRINT, PRODUCT_IMAGES_DIR, PRODUCT_ROOT, TEST_PROMPT, MODEL_PROFILES, singleImageCommand, IMAGE_REFERENCE_REFRESH_INTERVAL } from "./config.js";
import { normalizeDianxiaomiFacts, buildProductFactsFallback } from "./dianxiaomi-facts.js";
import { loadVerifiedText, productKeyOf, recordArtifact } from "./progress-manifest.js";
import { scanProductImages } from "./image-files.js";
import { extractImagePrompt, isOutlineOnlyPlanningText, readPrompt, validatePromptPack } from "./prompt-files.js";
import { validateImageFramework } from "./image-framework.js";
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
            // 批量制作跳过市场调研，MVP1 后直接生成 SEO/Listing
            return (state.skipResearch || state.researchCompleted) ? "seo" : "research";
        }
        return "planning";
    }
    if (state.completedPhase === "MVP3")
        return "images";
    return "seo";
}
export function isSeoContentReady(state) {
    if (state.standardWorkflowGoal === "seo_content_only") {
        // skipResearch 时只要求完成 MVP1，不要求市场调研
        return state.completedPhase === "MVP1" &&
            (Boolean(state.skipResearch) || Boolean(state.researchCompleted));
    }
    return state.completedPhase === "MVP4" &&
        (state.generatedImageNumbers ?? []).length === 10;
}
/**
 * B) verify-then-commit：断言一组产物文件存在且内容达到最小长度。
 * 返回失败描述数组（空数组 = 通过），便于调用方决定阻断提交还是仅告警。
 */
export async function checkArtifacts(checks) {
    const failed = [];
    for (const check of checks) {
        let len = 0;
        try {
            len = (await readFile(check.path, "utf8")).trim().length;
        }
        catch {
            len = 0;
        }
        if (len < check.minLength) {
            failed.push(`${path.basename(check.path)}=${len}字(<${check.minLength})`);
        }
    }
    return failed;
}
/**
 * B) verify-then-commit：product-facts 的标题 / 详情 / 主图三必填项校验。
 * 与 server.js checkDianxiaomiFactsReady 口径一致，避免"文件在但内容空"。
 */
export function checkFactsReady(facts) {
    const okTitle = !!(facts && facts.title && (facts.title.zh || facts.title.en));
    const okDesc = !!(facts && facts.description && (facts.description.pc || facts.description.mobile));
    const okImg = !!(facts && Array.isArray(facts.images && facts.images.main) && facts.images.main.length > 0);
    const missing = [];
    if (!okTitle)
        missing.push("标题(title)");
    if (!okDesc)
        missing.push("详情页(description)");
    if (!okImg)
        missing.push("主图(images.main)");
    return { ok: missing.length === 0, missing, okTitle, okDesc, okImg };
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
            // 严格匹配：只用 fingerprint 是否命中，避免把前一步回复误判为「本步 Prompt 已发」
            if (await this.ai.hasUserPromptStrict(fingerprint))
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
    async waitForStageResponse(fingerprint, options = {}) {
        const label = options.label ?? "当前阶段";
        const waitOptions = {
            shouldPause: () => Boolean(this.store.get().pauseRequested)
        };
        try {
            return await this.ai.waitForResponseAfterPrompt(fingerprint, waitOptions);
        }
        catch (error) {
            if (error?.code !== "CHATGPT_STOPPED_WITHOUT_OUTPUT") {
                throw error;
            }
            // 原 Prompt 已确认发送但 ChatGPT 已停止且没有回复：不能重发原长 Prompt。
            // 只追加一次带独立指纹的续写指令；再次失败交给人工审核，避免重复任务污染对话。
            const recoveryFingerprint = `${fingerprint} · Workflow Recovery`;
            const hasStrictPrompt = typeof this.ai.hasUserPromptStrict === "function"
                ? this.ai.hasUserPromptStrict.bind(this.ai)
                : this.ai.hasUserPrompt.bind(this.ai);
            const recoveryAlreadySent = await hasStrictPrompt(recoveryFingerprint);
            await this.store.update({
                stage: options.recoveryStage ?? "RECOVERING_RESPONSE",
                message: recoveryAlreadySent
                    ? `${label}续写指令已存在，正在从断点等待回复…`
                    : `${label}未返回内容，正在追加一次续写指令…`,
                error: undefined
            });
            if (!recoveryAlreadySent) {
                const recoveryPrompt = `# ${recoveryFingerprint}\n\n上一条「${label}」任务已发送，但 ChatGPT 在未输出结果前停止。请继续完成上一条任务，不要重复解释、不重做已完成内容，直接输出完整结果。输出结束时单独一行写：<STAGE_COMPLETE>。`;
                await this.ai.sendPromptOnce(recoveryPrompt, recoveryFingerprint, options.modelProfile);
            }
            return await this.ai.waitForResponseAfterPrompt(recoveryFingerprint, waitOptions);
        }
    }
    async selectStandardWorkflowGoal(goal) {
        const state = this.store.get();
        if (state.workflowMode !== "standard_listing") {
            throw new Error("仅标准 Listing 模式可以选择此任务目标");
        }
        if (state.running || state.autoRun) {
            throw new Error("流程运行中，不能切换任务目标");
        }
        // 健康检查会把 ChatGPT 首页写入 chatUrl；首页没有承载当前商品的
        // 对话上下文，不应阻塞批处理进入下一行。只有真实会话才锁定任务目标。
        const hasActiveConversation = /^https:\/\/chatgpt\.com\/c\//.test(String(state.chatUrl ?? "")) ||
            /^https:\/\/gemini\.google\.com\/app\//.test(String(state.chatUrl ?? ""));
        if (hasActiveConversation || state.completedPhase) {
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
                    message: this.readinessMessage(readiness.status, provider),
                    error: readiness.status === "verification_required"
                        ? `${this.providerName(provider)} 正在要求真人验证`
                        : this.readinessError(readiness.status, provider)
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
                        autoRun: false,
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
            const imageUploadReady = readiness.imageUpload?.ready;
            const imageUploadReason = readiness.imageUpload?.reason;
            // 运行期间的「重新检查连接」只能写健康快照。绝不能覆盖正在等待、
            // 恢复或生成中的业务阶段，否则前端会显示“已登录、可开始”，后台却仍在执行。
            if (state.running || state.autoRun) {
                return this.store.update({
                    browserStarted: readiness.ready,
                    imageUploadReady,
                    imageUploadReason,
                    browserHealth: {
                        status: readiness.status,
                        ready: readiness.ready,
                        checkedAt: new Date().toISOString()
                    }
                });
            }
            if (readiness.ready &&
                state.completedPhase &&
                !this.isConversationUrl(provider, state.chatUrl ?? "")) {
                await this.migrateCurrentProduct(this.ai, state);
                return this.store.get();
            }
            const uploadBlocked = readiness.ready && imageUploadReady === false;
            return this.store.update({
                browserStarted: true,
                // 浏览器健康检查只能确认登录，不能把用户当前打开的任意历史对话
                // 认作“当前产品”的会话。否则空工作区在导入图片前执行检查，会被
                // 误写 chatUrl，随后 import-images 因“商品已进入对话”被错误锁死。
                chatUrl: state.chatUrl && this.isConversationUrl(provider, readiness.url)
                    ? readiness.url
                    : state.chatUrl,
                stage: "READY_FOR_LOGIN",
                imageUploadReady,
                imageUploadReason,
                message: uploadBlocked
                    ? `${this.providerName(provider)} 已登录，但图片上传入口不可用：${imageUploadReason}`
                    : this.readinessMessage(readiness.status, provider),
                error: readiness.status === "verification_required"
                    ? `请在普通 Chrome 中完成 ${this.providerName(provider)} 人机验证；程序不会尝试绕过验证。`
                    : uploadBlocked
                        ? `图片上传预检未通过：${imageUploadReason}`
                        : readiness.ready
                            ? undefined
                            : this.readinessError(readiness.status, provider)
            });
        }
        catch (error) {
            const current = this.store.get();
            if (current.running || current.autoRun) {
                return this.store.update({
                    browserHealth: {
                        status: "unavailable",
                        ready: false,
                        detail: error instanceof Error ? error.message : String(error),
                        checkedAt: new Date().toISOString()
                    }
                });
            }
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
            imageFrameworkReport: undefined,
            imageFrameworkValid: undefined,
            frameworkRetryAttempted: undefined,
            completedPhase: undefined,
            currentImageNumber: undefined,
            generatedImageNumbers: [],
            outputFiles: [],
            startedAt: new Date().toISOString()
        });
        try {
            const images = await scanProductImages();
            const seoOnly = this.store.get().standardWorkflowGoal === "seo_content_only";
            if (images.length === 0 && !seoOnly) {
                throw new Error("产品图为空，请先选择文件夹导入图片");
            }
            await this.store.update({
                imageCount: images.length,
                imageNames: images.map((image) => image.name),
                stage: "CREATING_CHAT",
                message: images.length
                    ? `已找到 ${images.length} 张去重图片，正在新建 ${this.providerName(this.store.get().provider)} 对话…`
                    : "seo_content_only 模式跳过图片，正在新建对话…"
            });
            const readiness = await this.ai.checkReady();
            if (!readiness.ready) {
                throw new Error(this.readinessError(readiness.status));
            }
            const chatUrl = await this.ai.createBlankChat();
            if (images.length > 0) {
                const imageUpload = await this.ai.checkImageUploadReady();
                if (!imageUpload.ready) {
                    throw new Error(`ChatGPT 图片上传预检未通过：${imageUpload.reason}。本次未发送产品识别 Prompt，请稍后重试。`);
                }
                await this.store.update({
                    chatUrl,
                    stage: "UPLOADING_IMAGES",
                    message: `正在上传 ${images.length} 张产品图片…`
                });
                await this.ai.uploadImages(images.map((image) => image.path));
            }
            await this.store.update({
                stage: "SENDING_PROMPT",
                message: images.length ? "图片上传完成，正在发送测试 Prompt…" : "正在发送测试 Prompt…"
            });
            await this.ai.sendPromptOnce(buildProductFactPrompt(this.store.get()), PRODUCT_FACT_PROMPT_FINGERPRINT, MODEL_PROFILES.identify);
            await this.store.update({
                chatUrl: this.ai.currentUrl(),
                stage: "WAITING_FOR_RESPONSE",
                message: `Prompt 已发送，正在等待 ${this.providerName(this.store.get().provider)} 回复完成…`
            });
            const responseText = await this.waitForStageResponse(PRODUCT_FACT_PROMPT_FINGERPRINT, {
                label: "产品识别",
                modelProfile: MODEL_PROFILES.identify
            });
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
    /**
     * 为「框架校验失败后重跑规划」准备全新对话：新建空白对话并重新上传产品图。
     * 仅用于 continueThroughPlanning 的自动重跑，不重置 MVP1 事实/调研文本。
     */
    async prepareNewChatForPlanning() {
        const images = await scanProductImages();
        const readiness = await this.ai.checkReady();
        if (!readiness.ready) {
            throw new Error(this.readinessError(readiness.status));
        }
        const chatUrl = await this.ai.createBlankChat();
        if (images.length > 0) {
            const imageUpload = await this.ai.checkImageUploadReady();
            if (!imageUpload.ready) {
                throw new Error(`ChatGPT 图片上传预检未通过：${imageUpload.reason}。本次未重跑规划，请稍后重试。`);
            }
            await this.ai.uploadImages(images.map((image) => image.path));
        }
        await this.store.update({
            chatUrl,
            imageCount: images.length,
            imageNames: images.map((image) => image.name),
            message: `已新建对话并上传 ${images.length} 张产品图，准备重跑视觉规划…`
        });
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
            // 批量模式跳过联网调研时，使用不引用 Top 10 / Chrome AI 的简化规划 Prompt，
            // 从根上避免 ChatGPT 自行打开联网搜索去查找“市场数据”而再次卡死。
            const planningPromptTemplate = existing.skipResearch
                ? await readPrompt("planningNoResearch")
                : await readPrompt("planning");
            const restoredChatUrl = await this.ai.openChat(existing.chatUrl);
            if (restoredChatUrl && restoredChatUrl !== existing.chatUrl) {
                await this.store.update({ chatUrl: restoredChatUrl });
            }
            const researchText = await this.ensureResearch(existing);
            await this.store.update({
                researchText,
                researchCompleted: true,
                stage: "SENDING_PLANNING",
                message: existing.skipResearch
                    ? "已跳过联网市场调研，正在发送基于产品图的视觉规划 Prompt…"
                    : "市场调研完成，正在发送视觉规划 Prompt…"
            });
            // skipResearch 时使用无联网模板（无 {{CHROME_AI_REPORT}} 变量，无需替换）；
            // 否则将市场调研报告注入规划 Prompt。
            const planningPrompt = existing.skipResearch
                ? planningPromptTemplate
                : planningPromptTemplate.replace("{{CHROME_AI_REPORT}}", researchText);
            let planningText = existing.planningText;
            if (!planningText) {
                if (await this.ai.hasUserPromptStrict("Single Image Prompt Pack")) {
                    await this.store.update({
                        stage: "WAITING_FOR_PLANNING",
                        message: "检测到视觉规划 Prompt 已发送，正在从断点等待回复…"
                    });
                    planningText = await this.waitForStageResponse("Single Image Prompt Pack", {
                        label: "视觉规划",
                        modelProfile: MODEL_PROFILES.planning
                    });
                }
                else {
                    await this.ai.sendPromptOnce(planningPrompt, "Single Image Prompt Pack", MODEL_PROFILES.planning);
                    await this.store.update({
                        stage: "WAITING_FOR_PLANNING",
                        message: "视觉规划已发送，正在等待 Image 1–10 Prompt Pack…"
                    });
                    planningText = await this.waitForStageResponse("Single Image Prompt Pack", {
                        label: "视觉规划",
                        modelProfile: MODEL_PROFILES.planning
                    });
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
                // 自动补全：检测「大纲/分段预告」型半截回复，多轮「继续」直到 20 个 marker 全齐且内容充足
                const recovered = await this.autoCompletePlanningText(planningText);
                planningText = recovered.text;
                validation = validatePromptPack(planningText);
                await this.store.update({
                    planningText,
                    stage: "VALIDATING_PROMPT_PACK",
                    message: validation.valid
                        ? "自动续写成功，正在校验 Image 01–10 Prompt 标记…"
                        : `自动续写后仍缺失部分 Prompt（缺 ${validation.missing.length} 标记 / ${validation.short.length} 空壳），请检查 ChatGPT 会话或手动继续`
                });
            }
            if (!validation.valid) {
                console.warn("[planning] Prompt Pack 校验未通过，缺失：", validation.missing.join(", "), "内容不足：", validation.short?.join(", ") || "无");
            }
            // 10 图框架校验（v1.0 标准）：10 槽互异 + 第 3 槽 = 尺寸/比例 + 使用场景 ≤ 2。
            // 不通过则硬拦截（FAILED），防止模型跑偏后仍进入出图、产出同质化图片。
            const framework = validateImageFramework(planningText);
            console.log("[planning] 10 图框架校验:", JSON.stringify({
                ok: framework.ok,
                violations: framework.violations,
                warnings: framework.warnings,
                slots: framework.slots.map((s) => `${s.num}:${s.job}`)
            }));
            if (!framework.ok) {
                await this.store.update({
                    planningText,
                    imageFrameworkReport: framework,
                    imageFrameworkValid: false
                }).catch(() => { });
                const alreadyRetried = Boolean(existing.frameworkRetryAttempted);
                if (!alreadyRetried) {
                    // 硬拦截不再变死路：自动开新对话重跑一次规划（同对话会被 hasUserPromptStrict 复用旧文本）。
                    console.warn(`[planning] 10 图框架校验未通过，自动开新对话重跑一次：${framework.violations.join("；")}`);
                    await this.store.update({
                        frameworkRetryAttempted: true,
                        stage: "SENDING_PLANNING",
                        message: "10 图框架未通过，正在新建对话重跑规划（第 2 次）…"
                    });
                    await this.prepareNewChatForPlanning();
                    // 清空 planningText 并释放 running，让递归调用在新对话里重新发送规划
                    await this.store.update({ planningText: undefined, promptPackValid: undefined, running: false });
                    return await this.continueThroughPlanning();
                }
                const frameworkError = new Error(`10 图框架校验未通过（已自动重跑 1 次仍失败）：${framework.violations.join("；")}。请人工检查规划后重跑。`);
                frameworkError.code = "IMAGE_FRAMEWORK_INVALID";
                throw frameworkError;
            }
            await this.store.update({
                stage: "COMPLETED",
                message: validation.valid ? "MVP 2–3 已完成，Prompt Pack 与 10 图框架校验通过" : "MVP 2–3 已完成，Prompt Pack 校验未通过（仍按用户设置放行，请在 MVP4 前确认内容完整）",
                running: false,
                // 不再强制写死 true：真实反映校验结果，MVP4 会据其兜底修复
                promptPackValid: Boolean(validation.valid),
                imageFrameworkReport: framework,
                imageFrameworkValid: true,
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
            const restoredChatUrl = await this.ai.openChat(existing.chatUrl);
            if (restoredChatUrl && restoredChatUrl !== existing.chatUrl) {
                await this.store.update({ chatUrl: restoredChatUrl });
            }
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
            const restoredChatUrl = await this.ai.openChat(existing.chatUrl);
            if (restoredChatUrl && restoredChatUrl !== existing.chatUrl) {
                await this.store.update({ chatUrl: restoredChatUrl });
            }
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
                // 先提取本图生图 Prompt（规划文本不完整时自动补全），供后续发送分支使用
                let imagePrompt;
                try {
                    imagePrompt = extractImagePrompt(existing.planningText, imageNumber);
                }
                catch (extractError) {
                    const planningNow = this.store.get().planningText || existing.planningText || "";
                    const looksBroken = isOutlineOnlyPlanningText(planningNow) ||
                        !validatePromptPack(planningNow).valid;
                    if (!looksBroken) {
                        throw extractError;
                    }
                    await this.store.update({
                        stage: "VALIDATING_PROMPT_PACK",
                        message: `Image ${imageNumber} Prompt 提取失败，检测到规划文本不完整，正在自动回退修复…`
                    });
                    const recovered = await this.autoCompletePlanningText(planningNow);
                    if (!recovered.valid) {
                        throw extractError;
                    }
                    existing.planningText = recovered.text;
                    await this.store.update({
                        planningText: recovered.text,
                        promptPackValid: true,
                        message: `规划文本已自动补全，继续生成 Image ${imageNumber}…`
                    });
                    imagePrompt = extractImagePrompt(recovered.text, imageNumber);
                }
                // 断点恢复：若 ChatGPT 当前就在生成该图（stop 按钮可见），先等待完成；
                // 超时则回落到下方“重新发送”分支，避免 hasUserPrompt 误判导致傻等。
                if (interruptedCurrentImage) {
                    const page = await this.ai.requirePage();
                    const stopVisible = await this.ai.stopButton(page).isVisible().catch(() => false);
                    if (stopVisible) {
                        await this.store.update({
                            stage: "DOWNLOADING_IMAGE",
                            currentImageNumber: imageNumber,
                            message: `Image ${imageNumber} 正在生成中，正在等待完成…`
                        });
                        try {
                            await this.ai.waitForGeneratedImageAndDownload("", outputPath);
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
                        catch {
                            console.warn(`[automation] Image ${imageNumber} 断点等待超时，改走重新发送分支`);
                        }
                    }
                }
                await this.store.update({
                    stage: "GENERATING_IMAGES",
                    currentImageNumber: imageNumber,
                    message: `正在切换创建图片模式并生成 Image ${imageNumber}…`
                });
                const generationInput = await this.visualAssets.validateGenerationInput({
                    image_number: imageNumber,
                    image_prompt: imagePrompt,
                    prompt_version: "single-image-v1"
                });
                // 单图生成超时重试：某张图 ChatGPT 未生成 / 选择器未命中时，最多重试 2 次（共 3 次尝试），
                // 避免一张图卡死就让整批 10 张全部失败。
                const MAX_IMAGE_ATTEMPTS = 3;
                let imageSaved = false;
                // 基线 = 最后一张生成图的 src（不是数量）。DOM 虚拟化会让数量抖动，
                // 按数量判断会永远判不到新图（2026-10-24 真机 Image 3/4 即因此反复超时 FAILED）。
                const imageTaskBaseline = await this.ai.generatedImageLastSrc();
                for (let attempt = 0; attempt < MAX_IMAGE_ATTEMPTS && !imageSaved; attempt += 1) {
                    if (attempt > 0) {
                        await this.store.update({
                            message: `Image ${imageNumber} 第 ${attempt} 次重试生成（前次超时未检测到图）…`
                        });
                        // 先短等待回收上一轮迟到出现的图（45s）；能回收就不再重复发送，避免刷屏与上下文膨胀。
                        try {
                            await this.ai.waitForGeneratedImageAndDownload(imageTaskBaseline, outputPath, 45_000);
                            imageSaved = true;
                            break;
                        }
                        catch {
                            // 没有可用新图 → 继续走"重新发送"分支
                        }
                    }
                    await this.ai.enableImageCreation();
                    // 同一对话内产品图只上传一次（或按 IMAGE_REFERENCE_REFRESH_INTERVAL 定期刷新），
                    // 避免 10 张图 × 3 张源图的重复提交撑大会话上下文、拉长上传耗时。
                    // 用户反馈（2026-10-23）：「一个产品的对话框里面不用重复提交产品图片」。
                    if (IMAGE_REFERENCE_REFRESH_INTERVAL > 0 &&
                        imageNumber > 1 &&
                        (imageNumber - 1) % IMAGE_REFERENCE_REFRESH_INTERVAL === 0) {
                        this.ai.resetUploadedImages();
                    }
                    const upload = await this.ai.uploadImages(generationInput.reference_image_paths);
                    // 基线统一用 imageTaskBaseline（不在每次重试重取，避免被迟到图推高）
                    // 附件在「本条消息」还是「本对话历史」，Prompt 文案必须跟着变，
                    // 否则模型会去找本条消息里并不存在的附件。
                    const command = singleImageCommand(imageNumber, imagePrompt, { withImages: upload.attached });
                    await this.ai.sendPromptOnce(command, `请生成 Image ${imageNumber}`, MODEL_PROFILES.image);
                    await this.store.update({
                        stage: "DOWNLOADING_IMAGE",
                        message: `Image ${imageNumber} 已派发，正在等待生成并下载…`
                    });
                    try {
                        await this.ai.waitForGeneratedImageAndDownload(imageTaskBaseline, outputPath);
                        imageSaved = true;
                    }
                    catch (waitError) {
                        if (attempt >= MAX_IMAGE_ATTEMPTS - 1) {
                            throw waitError; // 3 次都失败 → 冒泡到 generateImages 的 catch，标记 FAILED
                        }
                        console.warn(`[automation] Image ${imageNumber} 生成超时，准备重试：${waitError?.message || waitError}`);
                        // 清理可能残留的生成态，避免下一轮 sendPromptOnce 被 stop 按钮卡住
                        try {
                            const page = await this.ai.requirePage();
                            await this.ai.clickStopSafely(page);
                        }
                        catch {
                            // 忽略清理失败
                        }
                        await new Promise((resolve) => setTimeout(resolve, 2_000));
                    }
                }
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
    /**
     * 单图重生成：只重新生成指定编号的一张图，不动其他 9 张、不改 completedPhase。
     * 用于 UI 上对某张图不满意时单独重跑（避免整套 10 张重来）。
     */
    async regenerateSingleImage(imageNumber) {
        const n = Number(imageNumber);
        if (!Number.isInteger(n) || n < 1 || n > 10) {
            throw new Error("图片编号必须是 1–10 的整数");
        }
        if (this.store.get().running) {
            throw new Error("当前已有任务正在运行");
        }
        const existing = this.store.get();
        if (!existing.planningText) {
            throw new Error("尚未完成视觉规划，无法单图重生成");
        }
        if (!existing.chatUrl) {
            throw new Error("尚未建立商品对话，无法单图重生成");
        }
        const imagePrompt = extractImagePrompt(existing.planningText, n);
        const fileName = `Image_${String(n).padStart(2, "0")}.jpg`;
        const outputPath = path.join(OUTPUT_DIR, fileName);
        // 备份旧图（避免 waitForGeneratedImageAndDownload 因「文件已存在」直接返回）
        await rename(outputPath, `${outputPath}.bak-${Date.now()}`).catch(() => { });
        const generatedBefore = new Set(existing.generatedImageNumbers ?? []);
        generatedBefore.delete(n);
        await this.store.update({
            running: true,
            pauseRequested: false,
            error: undefined,
            interruptedStage: undefined,
            stage: "GENERATING_IMAGES",
            currentImageNumber: n,
            generatedImageNumbers: [...generatedBefore].sort((a, b) => a - b),
            outputFiles: (existing.outputFiles ?? []).filter((f) => f !== fileName),
            message: `正在重新生成 Image ${n}…`
        });
        try {
            await this.ai.openChat(existing.chatUrl);
            const generationInput = await this.visualAssets.validateGenerationInput({
                image_number: n,
                image_prompt: imagePrompt,
                prompt_version: "single-image-v1"
            });
            const MAX_ATTEMPTS = 3;
            let saved = false;
            for (let attempt = 0; attempt < MAX_ATTEMPTS && !saved; attempt += 1) {
                if (attempt > 0) {
                    await this.store.update({ message: `Image ${n} 第 ${attempt} 次重试…` });
                }
                await this.ai.enableImageCreation();
                const upload = await this.ai.uploadImages(generationInput.reference_image_paths);
                const baseline = await this.ai.generatedImageLastSrc();
                const command = singleImageCommand(n, imagePrompt, { withImages: upload.attached });
                await this.ai.sendPromptOnce(command, `请生成 Image ${n}`, MODEL_PROFILES.image);
                await this.store.update({
                    stage: "DOWNLOADING_IMAGE",
                    message: `Image ${n} 已派发，正在等待生成并下载…`
                });
                try {
                    await this.ai.waitForGeneratedImageAndDownload(baseline, outputPath);
                    saved = true;
                }
                catch (waitError) {
                    if (attempt >= MAX_ATTEMPTS - 1) {
                        throw waitError;
                    }
                    await this.ai.clickStopSafely(await this.ai.requirePage()).catch(() => { });
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                }
            }
            const done = new Set([...(this.store.get().generatedImageNumbers ?? []), n]);
            const phase = this.store.get().completedPhase;
            const finalStage = phase === "MVP4" || phase === "MVP5" ? "COMPLETED" : "GENERATING_IMAGES";
            await this.store.update({
                stage: finalStage,
                running: false,
                autoRun: false,
                currentImageNumber: undefined,
                generatedImageNumbers: [...done].sort((a, b) => a - b),
                outputFiles: [...new Set([...(this.store.get().outputFiles ?? []), fileName])],
                error: undefined,
                interruptedStage: undefined,
                message: `Image ${n} 已重新生成完成`
            });
        }
        catch (error) {
            await this.fail(error);
            throw error;
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
            const restoredChatUrl = await this.ai.openChat(existing.chatUrl);
            if (restoredChatUrl && restoredChatUrl !== existing.chatUrl) {
                await this.store.update({ chatUrl: restoredChatUrl });
            }
            // 大对话降级：原对话若因内联生成图过多无法在浏览器端渲染线程（composer 缺失 /
            // composer_unavailable），openChat 后依旧无法发送。降级到新建对话：重传源产品图 +
            // 注入已抽取的产品事实，使 ChatGPT 在无原对话上下文时仍能产出完整 Listing 文案。
            const readiness = await this.ai.checkReady().catch(() => ({ ready: false, status: "composer_unavailable" }));
            let freshChatContext = "";
            if (!readiness.ready || readiness.status === "composer_unavailable") {
                console.warn("[seo] 原对话无法渲染，降级到新建对话生成 Listing 文案");
                await this.ai.createBlankChat();
                try {
                    const srcImages = await scanProductImages();
                    if (srcImages.length) {
                        await this.ai.uploadImages(srcImages.map((image) => image.path));
                    }
                } catch (imgErr) {
                    console.warn("[seo] 降级对话重传源图失败（继续，依赖注入事实）:", imgErr && imgErr.message);
                }
                freshChatContext = this.buildFreshChatFactsContext(existing);
            }
            // 批量模式下跳过市场调研：不注入 researchText，直接基于产品事实生成 SEO/Listing
            const seoPrompt = (seoOnly && !existing.skipResearch)
                ? `${seoPromptTemplate}

## 本商品已完成的联网市场调研与 VOC
<<<MARKET_RESEARCH_REPORT_START>>>
${existing.researchText ?? ""}
<<<MARKET_RESEARCH_REPORT_END>>>

请明确基于以上产品事实、市场调研和 VOC 生成关键词，不依赖视觉规划或生图结果。`
                : seoPromptTemplate;
            // 不使用 recoverCompletedResponse 预赋值：其「最后一条 assistant 兜底」会在首跑时把 MVP1 事实底稿误当成 SEO 词库，
            // 导致 SEO / Listing 两个 Prompt 都被跳过，最终 03/04 两份文件都写成事实底稿（"只做了事实确定"）。
            const manifestPath = path.join(PRODUCT_ROOT, "progress-manifest.json");
            const productKey = productKeyOf(existing);
            let seoKeywordText = existing.seoKeywordText;
            if (!seoKeywordText) {
                // C) 幂等对账：run-state 丢失但磁盘产物校验通过 → 直接复用，避免重复发送/生成。
                const seoFromDisk = await loadVerifiedText(manifestPath, productKey, "seo_keywords").catch(() => null);
                if (seoFromDisk && seoFromDisk.trim()) {
                    seoKeywordText = seoFromDisk.trim();
                    console.log("[manifest] SEO 词库经磁盘校验通过，复用（不重发 Prompt）");
                    await this.store.update({ seoKeywordText, message: "SEO 词库已从磁盘 manifest 复用，跳过重复生成" });
                }
            }
            if (!seoKeywordText) {
                if (await this.ai.hasUserPromptStrict(SEO_KEYWORDS_FINGERPRINT)) {
                    await this.store.update({
                        stage: "WAITING_FOR_SEO_KEYWORDS",
                        message: "SEO Prompt 已发送，正在从断点等待完整词库…"
                    });
                    seoKeywordText = await this.waitForStageResponse(SEO_KEYWORDS_FINGERPRINT, {
                        label: "SEO 关键词",
                        modelProfile: MODEL_PROFILES.seo
                    });
                }
                else {
                    await this.store.update({
                        stage: "SENDING_SEO_KEYWORDS",
                        message: existing.skipResearch
                            ? "正在发送 SEO 关键词 Prompt（批量模式不联网）…"
                            : "正在启用网页搜索并发送 SEO 关键词 Prompt…"
                    });
                    // 批量模式跳过市场调研时，不打开联网搜索开关，避免 ChatGPT 联网卡死。
                    if (!existing.skipResearch) {
                        await this.enableWebSearchIfAvailable("SEO 关键词");
                    }
                    await this.ai.sendPromptOnce(seoPrompt, SEO_KEYWORDS_FINGERPRINT, MODEL_PROFILES.seo);
                    await this.store.update({
                        stage: "WAITING_FOR_SEO_KEYWORDS",
                        message: "关键词研究已发送，正在等待完整词库…"
                    });
                    seoKeywordText = await this.waitForStageResponse(SEO_KEYWORDS_FINGERPRINT, {
                        label: "SEO 关键词",
                        modelProfile: MODEL_PROFILES.seo
                    });
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
                freshChatContext,
                listingPromptTemplate.replace("{{SEO_KEYWORD_REPORT}}", seoKeywordText)
            ].filter(Boolean).join("\n\n");
            // 不使用 recoverCompletedResponseForFingerprints 预赋值：其底层 recover 的「最后一条 assistant 兜底」
            // 会在首跑时把 MVP1/SEO 的回复误当成 Listing 文案，导致 Listing Prompt 被跳过。
            let listingContentText = existing.listingContentText;
            if (!listingContentText) {
                // C) 幂等对账：Listing 文案磁盘校验通过则复用，避免重复发送。
                const listingFromDisk = await loadVerifiedText(manifestPath, productKey, "listing_content").catch(() => null);
                if (listingFromDisk && listingFromDisk.trim().length > 200) {
                    listingContentText = listingFromDisk.trim();
                    console.log("[manifest] Listing 文案经磁盘校验通过，复用（不重发 Prompt）");
                    await this.store.update({ listingContentText, message: "Listing 文案已从磁盘 manifest 复用，跳过重复生成" });
                }
            }
            if (!listingContentText) {
                if (await this.hasUserPromptForFingerprints(LISTING_CONTENT_FINGERPRINTS)) {
                    await this.store.update({
                        stage: "WAITING_FOR_LISTING_CONTENT",
                        message: "Listing Prompt 已发送，正在从断点等待完整内容…"
                    });
                    listingContentText = await this.waitForResponseAfterFingerprints(LISTING_CONTENT_FINGERPRINTS);
                }
                else {
                    await this.ai.sendPromptOnce(listingPrompt, LISTING_CONTENT_FINGERPRINT, MODEL_PROFILES.listing);
                    await this.store.update({
                        stage: "WAITING_FOR_LISTING_CONTENT",
                        message: "Listing 文案 Prompt 已发送，正在等待完整交付内容…"
                    });
                    listingContentText = await this.waitForStageResponse(LISTING_CONTENT_FINGERPRINT, {
                        label: "Listing 文案",
                        modelProfile: MODEL_PROFILES.listing
                    });
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
            // C) 幂等 manifest：记录产物校验和，供断点对账/复用。
            await Promise.all([
                recordArtifact({ manifestPath, productKey, step: "seo_keywords", filePath: path.join(OUTPUT_DIR, "03_SEO_KEYWORDS.md") }),
                recordArtifact({ manifestPath, productKey, step: "listing_content", filePath: path.join(OUTPUT_DIR, "04_LISTING_CONTENT.md") })
            ]).catch((manifestErr) => console.warn("[manifest] 记录 SEO/Listing 产物失败（非致命）:", manifestErr && manifestErr.message));
            // B) verify-then-commit：推进到 COMPLETED 之前先回读产物并断言内容非空。
            // 把"状态绿、产物空"从"靠翻日志发现"变成"代码拦截"。阈值取保守下限，
            // 正常 SEO 词库 ≥10k 字、Listing ≥13k 字，远高于此。
            const artifactFailures = await checkArtifacts([
                { path: path.join(OUTPUT_DIR, "03_SEO_KEYWORDS.md"), minLength: 200 },
                { path: path.join(OUTPUT_DIR, "04_LISTING_CONTENT.md"), minLength: 500 }
            ]);
            if (artifactFailures.length) {
                const verifyError = new Error(`MVP5 产物校验未通过（${artifactFailures.join("；")}），已阻止标记完成`);
                verifyError.code = "ARTIFACT_VERIFY_FAILED";
                throw verifyError;
            }
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
            // 批量制作模式下跳过：避免额外 ChatGPT 调用阻塞下一行。
            if (!existing.skipProductFacts) {
                try {
                    await this.generateProductFactsFile(existing, listingContentText);
                }
                catch (factsError) {
                    console.error("[product-facts] 整理 product-facts.json 失败（非致命，不影响 MVP5 完成）:", factsError);
                    await this.store.update({
                        productFactsReady: false,
                        productFactsError: factsError instanceof Error ? factsError.message : String(factsError)
                    }).catch(() => {});
                }
            }
        }
        catch (error) {
            await this.fail(error);
        }
    }
    buildFreshChatFactsContext(state) {
        const blocks = [];
        if (state.responseText) {
            blocks.push("## 产品事实底稿（MVP1 识别）\n<<<FACTS_START>>>\n" + state.responseText + "\n<<<FACTS_END>>>");
        }
        if (state.researchText) {
            blocks.push("## 市场调研 / VOC\n<<<RESEARCH_START>>>\n" + state.researchText + "\n<<<RESEARCH_END>>>");
        }
        if (state.objectiveInfo) {
            blocks.push("## 用户补充参数\n" + state.objectiveInfo);
        }
        if (!blocks.length) return "";
        return "以下为本次商品已完成的识别 / 调研资料，请作为「本对话中的产品识别、市场调研、视觉规划」上下文使用（替代原对话历史）：\n\n" + blocks.join("\n\n");
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
        // 【修复】本地兜底优先：不依赖 ChatGPT（不联网、不写 composer），先算出可用 facts 并立即写盘。
        // 保证即使 CDP 抖动 / 发送失败 / AI 桥接超时，product-facts.json 也一定产出，不再出现「MVP5 完成但缺文件」。
        let facts = await buildProductFactsFallback({ factText, listingContentText, baseDir: PRODUCT_ROOT });
        let usedFallback = true;
        // 主图优先使用 MVP4 AI 生成的 Listing 图（output/Image_01.jpg ...），而非原始 1688 产品图。
        // 标准布局：生成图只在 output/，不复制到 产品图/；店小秘端通过 resolveImagePath 自动兜底查找。
        try {
            const outFiles = await readdir(OUTPUT_DIR).catch(() => []);
            const generated = outFiles
                .filter((f) => /^Image_\d+\.(png|jpg|jpeg|webp)$/i.test(f))
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                .slice(0, 6);
            if (generated.length) {
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
        const target = path.join(PRODUCT_ROOT, "product-facts.json");
        const persistFacts = async () => {
            await mkdir(PRODUCT_ROOT, { recursive: true });
            await writeFile(target, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
            // 同步镜像到根目录 product-facts.json：店小秘 manual 面板与「上架」(dxReferenceApply，不带 facts)
            // 都读此文件。不镜像会造成面板事实文件与桥接产物不一致（已踩坑：ruTie 旧档覆盖箱包新档）。
            try {
                await writeFile(PRODUCT_FACT_FILE, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
            }
            catch (mirrorErr) {
                console.warn("[product-facts] 镜像到根目录 product-facts.json 失败（非致命）:", mirrorErr);
            }
            // C) 幂等 manifest：记录 product-facts 校验和（本地兜底与 AI 覆盖写后都会更新）。
            try {
                await recordArtifact({
                    manifestPath: path.join(PRODUCT_ROOT, "progress-manifest.json"),
                    productKey: productKeyOf(state),
                    step: "product_facts",
                    filePath: target
                });
            }
            catch (manifestErr) {
                console.warn("[manifest] 记录 product-facts 失败（非致命）:", manifestErr && manifestErr.message);
            }
        };
        // 1) 先把本地兜底版落盘 —— 下游一定拿得到文件。
        await persistFacts();
        // B) verify-then-commit：回读校验三必填项（标题/详情/主图），不过则不标就绪。
        // 与 server.js checkDianxiaomiFactsReady 的口径一致，避免"文件在但内容空"。
        {
            let persisted = null;
            try {
                persisted = JSON.parse(await readFile(target, "utf8"));
            }
            catch {
                persisted = null;
            }
            const factsCheck = checkFactsReady(persisted);
            if (!factsCheck.ok) {
                const verifyError = new Error(`product-facts.json 校验失败（缺少：${factsCheck.missing.join("、")}），已阻止标记就绪`);
                verifyError.code = "ARTIFACT_VERIFY_FAILED";
                throw verifyError;
            }
        }
        const localMainImages = Array.isArray(facts.images?.main) ? [...facts.images.main] : [];
        await this.store.update({
            productFactsReady: true,
            productFactsFallback: true,
            productFactsPath: target,
            message: "MVP5 已完成（product-facts 为本地兜底版，可上架但建议人工复核标题/属性）"
        }).catch(() => {});
        // 2) AI 桥接仅作可选增强：带 120s 硬超时；成功则覆盖为结构化版并重写文件，失败/超时一律保留兜底版。
        //    关键：AI 桥接不再阻塞主流程，也不会因为 CDP 挂死导致 product-facts.json 缺失。
        const aiPromise = this.buildFactsViaAi(state, listingContentText);
        aiPromise.catch(() => { }); // 超时后后台 AI 桥接若拒绝，避免未捕获拒绝
        let bridgeTimer;
        try {
            const aiFacts = await Promise.race([
                aiPromise,
                new Promise((_, reject) => {
                    bridgeTimer = setTimeout(() => reject(new Error("AI 桥接超时（120s）")), 120_000);
                })
            ]);
            if (aiFacts) {
                const aiMain = Array.isArray(aiFacts.images?.main) ? aiFacts.images.main : [];
                aiFacts.images = aiFacts.images || {};
                aiFacts.images.main = aiMain.length ? aiMain : localMainImages;
                facts = aiFacts;
                usedFallback = false;
                await persistFacts();
                await this.store.update({
                    productFactsReady: true,
                    productFactsFallback: false,
                    productFactsPath: target,
                    message: "MVP 5 已完成，product-facts.json 已生成（AI 结构化版，可上架店小秘）"
                }).catch(() => {});
            }
        }
        catch (aiErr) {
            console.warn("[product-facts] AI 桥接未采用，保留本地兜底版（非致命）:", aiErr && aiErr.message ? aiErr.message : aiErr);
        }
        finally {
            if (bridgeTimer)
                clearTimeout(bridgeTimer);
        }
        return facts;
    }
    /**
     * AI 桥接（可选增强）：把产品事实(MVP1) + Listing 文案(MVP5) 交给 AI 整理成结构化 JSON。
     * 仅在 generateProductFactsFile 已写好本地兜底版之后调用；失败/超时不影响文件存在。
     */
    async buildFactsViaAi(state, listingContentText) {
        const factText = state?.responseText || "";
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
        await this.ai.sendPromptOnce(prompt, PRODUCT_FACTS_STRUCTURE_FINGERPRINT, MODEL_PROFILES.factsBridge);
        const responseText = await this.waitForStageResponse(PRODUCT_FACTS_STRUCTURE_FINGERPRINT, {
            label: "店小秘资料整理",
            modelProfile: MODEL_PROFILES.factsBridge
        });
        const parsed = JSON.parse(extractJsonBlock(responseText));
        const aiFacts = normalizeDianxiaomiFacts(parsed);
        // 强制使用 MVP5 Listing 里的 Clean Title 与 AEO 结构化五点描述（AI 可能未严格按 prompt 提取）
        const cleanTitle = extractCleanTitle(listingContentText);
        if (cleanTitle) {
            aiFacts.title.en = cleanTitle;
            aiFacts.title.zh = aiFacts.title.zh || "";
        }
        const aeoSection = extractAeoSection(listingContentText);
        if (aeoSection) {
            aiFacts.description.pc = aeoSection;
            aiFacts.description.mobile = aeoSection;
        }
        return aiFacts;
    }
    async syncFromChatGpt() {
        const before = this.store.get();
        if (!before.chatUrl) {
            throw new Error("当前没有可同步的 AI 商品对话");
        }
        const restoredChatUrl = await this.ai.openChat(before.chatUrl);
        if (restoredChatUrl && restoredChatUrl !== before.chatUrl) {
            await this.store.update({ chatUrl: restoredChatUrl });
        }
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
    // 把「大纲 / 分段预告」型半截规划自动补全为完整规划。
    // 多轮发送续写指令，直到 20 个 marker 全齐且每个 prompt 内容充足。
    async autoCompletePlanningText(initialText) {
        const MAX_ROUNDS = 3;
        let text = initialText || (await this.readFullPlanningText());
        for (let round = 0; round < MAX_ROUNDS; round += 1) {
            const v = validatePromptPack(text, 10);
            if (v.valid)
                return { text, valid: true, rounds: round };
            // 只要没有完整 Prompt Pack，就尝试续写。ChatGPT 常见的「分段预告 / 大纲 / 承诺下一条回复」
            // 都属于可续写场景；即便不是大纲，补一次「请直接输出完整内容」也不会造成破坏。
            const fp = round === 0 ? "视觉规划自动补全指令" : `规划续写${round}`;
            const continuation = round === 0
                ? PLANNING_COMPLETION_PROMPT
                : "请继续从上一个未完成的 Image 编号开始，严格按照 <<<IMAGE_XX_PROMPT_START>>>…<<<IMAGE_XX_PROMPT_END>>> 固定边界，把剩余的完整生图 Prompt 一次性输出完毕；严禁再次只输出大纲、分段预告或'我将在下一条消息继续'等过渡文本。";
            await this.store.update({
                stage: "SENDING_PLANNING",
                message: `检测到规划仅输出大纲/分段预告，正在自动续写（第 ${round + 1}/${MAX_ROUNDS} 轮）…`
            });
            await this.ai.sendPromptOnce(continuation, fp, MODEL_PROFILES.planning);
            await this.store.update({
                stage: "WAITING_FOR_PLANNING",
                message: `规划续写指令已发送，正在等待完整 Prompt Pack（第 ${round + 1}/${MAX_ROUNDS} 轮）…`
            });
            await this.waitForStageResponse(fp, {
                label: "视觉规划续写",
                modelProfile: MODEL_PROFILES.planning
            });
            // 重读全量（锚定在规划 prompt，拼接其后所有 assistant 回复）
            text = await this.readFullPlanningText();
        }
        return { text, valid: validatePromptPack(text, 10).valid, rounds: MAX_ROUNDS };
    }
    // 锚定在规划 prompt（指纹 "Single Image Prompt Pack"），拼接其后所有 assistant 回复
    async readFullPlanningText() {
        try {
            const full = await this.ai.recoverCompletedResponse("Single Image Prompt Pack");
            if (full)
                return full;
        }
        catch {
            // 忽略 CDP 读取异常，回退到已存 planningText
        }
        return this.store.get().planningText || "";
    }
    async fail(error) {
        const message = error instanceof Error ? error.message : String(error);
        const current = this.store.get();
        const paused = error?.code === "WORKFLOW_PAUSED";
        const recoverable = /Target page, context or browser has been closed|专用 Chrome 尚未启动|connectOverCDP|ECONNREFUSED|Chrome.*关闭|浏览器.*关闭|browser is not connected/i.test(message);
        const currentUrl = this.ai.currentUrl();
        return this.store.update({
            stage: paused || recoverable ? "PAUSED" : "FAILED",
            interruptedStage: current.stage,
            message: paused
                ? "任务已暂停，可从当前阶段继续"
                : recoverable
                ? "流程已暂停，重新打开 Chrome 后可从断点继续"
                : "流程已停止，可修复后从断点继续",
            running: false,
            autoRun: false,
            chatUrl: currentUrl && this.isConversationUrl(current.provider, currentUrl)
                ? currentUrl
                : this.isConversationUrl(current.provider, current.chatUrl ?? "")
                    ? current.chatUrl
                    : undefined,
            error: paused ? undefined : message
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
        const fingerprint = "Chrome AI Top 3 Listing Visual Audit Prompt";
        // 批量模式 / 用户明确跳过市场调研：直接返回空报告，不触发联网搜索，避免 ChatGPT 搜索卡死导致整批阻塞。
        if (existing.skipResearch) {
            await this.store.update({
                researchText: "",
                researchCompleted: true,
                message: "批量模式跳过联网市场调研，直接基于产品图片进行视觉规划"
            });
            return "";
        }
        const researchPrompt = await readPrompt("research");
        // 不使用 recoverCompletedResponse 预赋值：其「最后一条 assistant 兜底」会在首跑时把前一步（MVP1）回复误当成市场调研结果，
        // 导致本步真正要发的调研 Prompt 被跳过。改为只信任已落盘字段 + 严格判断「本步 Prompt 是否真的发过」。
        let researchText = existing.researchText;
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
        if (await this.ai.hasUserPromptStrict(fingerprint)) {
            researchText = await this.waitForStageResponse(fingerprint, {
                label: "市场调研",
                recoveryStage: "RECOVERING_RESEARCH",
                modelProfile: MODEL_PROFILES.research
            });
        }
        else {
            await this.store.update({
                stage: "SENDING_RESEARCH",
                message: "正在启用网页搜索并发送市场调研 Prompt…"
            });
            await this.enableWebSearchIfAvailable("市场调研");
            await this.ai.sendPromptOnce(researchPrompt, fingerprint, MODEL_PROFILES.research);
            await this.store.update({
                stage: "WAITING_FOR_RESEARCH",
                message: "市场调研已发送，正在等待完整回复…"
            });
            researchText = await this.waitForStageResponse(fingerprint, {
                label: "市场调研",
                recoveryStage: "RECOVERING_RESEARCH",
                modelProfile: MODEL_PROFILES.research
            });
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
        // composer_unavailable：页面能打开但找不到输入框。多为 CDP 断连后引用失效、
        // 页面结构变化或页面未加载完成——都不是「没登录」，指引用户去登录只会浪费时间。
        if (status === "composer_unavailable") {
            return `${name} 页面已打开但输入框不可用，请检查 Chrome 标签页是否停留在 ChatGPT 对话界面，然后点击“重新检查”`;
        }
        return `请在打开的普通 Chrome 中登录 ${name}，然后点击“重新检查”`;
    }
    /**
     * 把 checkReady 的失败原因翻译成准确文案。
     * 此前所有失败一律报「未登录或输入框不可用」，把 CDP 断连/页面未就绪
     * 误报成登录问题，用户反复登录也无法恢复。
     */
    readinessError(status, provider = this.store.get().provider) {
        const name = this.providerName(provider);
        if (status === "verification_required") {
            return `${name} 正在要求真人验证。请在打开的普通 Chrome 中手动完成，然后点击“重新检查”。`;
        }
        if (status === "composer_unavailable") {
            return `${name} 页面已打开但输入框不可用：通常是 Chrome 调试连接断开或页面尚未加载完成。请确认 ChatGPT 标签页正常打开，点击“重新检查”重试。`;
        }
        if (status === "login_required") {
            return `${name} 未登录。请在打开的普通 Chrome 中登录 ${name}，然后点击“重新检查”。`;
        }
        return `${name} 未登录或输入框不可用，请点击“重新检查”重试。`;
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
