import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { CHARM_CONTEXT_IMAGES_DIR, CHARM_OUTPUT_DIR, CHARM_REF_IMAGES_DIR, COMPLETED_PRODUCTS_DIR } from "./config.js";
import { importImagesToDirectory, importImageUrlsToDirectory, removeImageFromDirectory, scanImages } from "./directory-images.js";
import { extractNumberedImagePrompt, readPrompt, validateNumberedPromptPack } from "./prompt-files.js";
import { sanitizeProductName } from "./product-session.js";
const CHARM_PROMPT_PACK_FINGERPRINT = "# Bag Charm Image 01–06 Prompt Pack";
const CHARM_LISTING_CONTENT_FINGERPRINT = "# Bag Charm Listing Content";
const CHARM_LISTING_CONTENT_START = "<<<BAG_CHARM_LISTING_CONTENT_START>>>";
const CHARM_LISTING_CONTENT_END = "<<<BAG_CHARM_LISTING_CONTENT_END>>>";
const TOTAL_CHARM_IMAGES = 6;
export class BagCharmService {
    store;
    adapters;
    constructor(store, adapters) {
        this.store = store;
        this.adapters = adapters;
    }
    get ai() {
        return this.adapters[this.store.get().provider];
    }
    /* ── 模式切换 ── */
    async selectMode(mode) {
        const state = this.store.get();
        if (state.running || state.autoRun)
            throw new Error("流程运行中，不能切换业务模式");
        if (state.workflowMode === mode)
            return state;
        if (mode === "bag_charm") {
            const existing = state.bagCharm?.taskId ? state.bagCharm : this.freshCharm();
            return this.store.update({
                workflowMode: "bag_charm",
                stage: "IDLE",
                message: "已切换到包包挂件 Listing 设计模式",
                bagCharm: existing,
                error: undefined
            });
        }
        if (state.workflowMode === "bag_charm" &&
            state.bagCharm?.taskId &&
            (state.bagCharm.generatedImageNumbers?.length || state.bagCharm.promptPackValid)) {
            throw new Error("当前包包挂件任务已开始，请先归档或清空后再切换业务模式");
        }
        return this.store.update({
            workflowMode: mode,
            stage: "IDLE",
            message: mode === "luxury_insert"
                ? "已切换到奢侈包内胆设计模式"
                : "已切换到标准 Listing 模式",
            bagCharm: undefined,
            error: undefined
        });
    }
    freshCharm() {
        return {
            taskId: this.taskId(),
            productName: "",
            brand: "",
            material: "",
            type: "Pendant",
            claims: { dispatch48h: true, returns7Day: true },
            refImageNames: [],
            contextImageNames: [],
            promptPackText: undefined,
            promptPackValid: false,
            generatedImageNumbers: [],
            outputFiles: [],
            currentImageNumber: undefined,
            listingContentText: undefined,
            listingContentGenerated: false,
            archiveDirectory: undefined
        };
    }
    assertCharmMode() {
        if (this.store.get().workflowMode !== "bag_charm") {
            throw new Error("请先切换到包包挂件 Listing 设计模式");
        }
    }
    requireCharm() {
        const charm = this.store.get().bagCharm;
        if (!charm?.taskId)
            throw new Error("当前没有包包挂件任务");
        return charm;
    }
    async fail(error) {
        await this.store.update({
            running: false,
            stage: "PAUSED",
            message: "包包挂件流程已暂停，修复后可从断点继续",
            error: error instanceof Error ? error.message : String(error)
        });
    }
    taskId() {
        return `CHARM-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
    }
    providerName(provider) {
        return provider === "gemini" ? "Gemini" : "ChatGPT";
    }
    /* ── 参考图 / 场景图上传 ── */
    async uploadRefImages(files) {
        this.assertCharmMode();
        const state = this.store.get();
        if (state.running)
            throw new Error("流程运行中，不能上传参考图");
        if (state.bagCharm?.promptPackValid)
            throw new Error("Prompt Pack 已生成，不能继续修改参考图");
        const result = await importImagesToDirectory(CHARM_REF_IMAGES_DIR, files);
        const charm = this.requireCharm();
        await this.store.update({
            bagCharm: {
                ...charm,
                refImageNames: [...(charm.refImageNames ?? []), ...result.imported]
            }
        });
        return { result };
    }
    async removeRefImage(name) {
        this.assertCharmMode();
        const state = this.store.get();
        if (state.running || state.bagCharm?.promptPackValid) {
            throw new Error("Prompt Pack 已生成或流程运行中，不能删除参考图");
        }
        await removeImageFromDirectory(CHARM_REF_IMAGES_DIR, name);
        const charm = this.requireCharm();
        await this.store.update({
            bagCharm: {
                ...charm,
                refImageNames: (charm.refImageNames ?? []).filter((item) => item !== name)
            }
        });
        return { deleted: true };
    }
    async importRefImageUrls(urls) {
        this.assertCharmMode();
        const state = this.store.get();
        if (state.running || state.bagCharm?.promptPackValid) {
            throw new Error("Prompt Pack 已生成或流程运行中，不能导入参考图");
        }
        const result = await importImageUrlsToDirectory(CHARM_REF_IMAGES_DIR, urls, undefined, { allowDuplicateContent: true });
        const charm = this.requireCharm();
        await this.store.update({
            bagCharm: {
                ...charm,
                refImageNames: [...(charm.refImageNames ?? []), ...result.imported]
            }
        });
        return result;
    }
    async uploadContextImages(files) {
        this.assertCharmMode();
        const state = this.store.get();
        if (state.running || state.bagCharm?.promptPackValid) {
            throw new Error("Prompt Pack 已生成或流程运行中，不能修改场景图");
        }
        const result = await importImagesToDirectory(CHARM_CONTEXT_IMAGES_DIR, files);
        const charm = this.requireCharm();
        await this.store.update({
            bagCharm: {
                ...charm,
                contextImageNames: [...(charm.contextImageNames ?? []), ...result.imported]
            }
        });
        return { result };
    }
    async removeContextImage(name) {
        this.assertCharmMode();
        const state = this.store.get();
        if (state.running || state.bagCharm?.promptPackValid) {
            throw new Error("Prompt Pack 已生成或流程运行中，不能删除场景图");
        }
        await removeImageFromDirectory(CHARM_CONTEXT_IMAGES_DIR, name);
        const charm = this.requireCharm();
        await this.store.update({
            bagCharm: {
                ...charm,
                contextImageNames: (charm.contextImageNames ?? []).filter((item) => item !== name)
            }
        });
        return { deleted: true };
    }
    /* ── 产品基础信息（用于 {{PRODUCT_NAME}} / 冻结事实） ── */
    async updateCharmMeta(meta) {
        this.assertCharmMode();
        const charm = this.requireCharm();
        const next = { ...charm };
        if (typeof meta.productName === "string")
            next.productName = meta.productName;
        if (typeof meta.brand === "string")
            next.brand = meta.brand;
        if (typeof meta.material === "string")
            next.material = meta.material;
        if (typeof meta.type === "string")
            next.type = meta.type;
        if (meta.claims && typeof meta.claims === "object") {
            next.claims = {
                dispatch48h: Boolean(meta.claims.dispatch48h),
                returns7Day: Boolean(meta.claims.returns7Day)
            };
        }
        await this.store.update({ bagCharm: next });
        return next;
    }
    /* ── 生成 6 图 Prompt Pack ── */
    async buildPromptPack() {
        this.assertCharmMode();
        const charm = this.requireCharm();
        if (!charm.refImageNames?.length)
            throw new Error("请先上传吊坠参考图");
        if (!charm.productName?.trim())
            throw new Error("请先填写产品名（PRODUCT_NAME）");
        if (!this.store.get().chatUrl)
            throw new Error("请先在专用 Chrome 中打开 AI 对话并设置 chatUrl");
        await this.store.update({
            running: true,
            pauseRequested: false,
            stage: "CHARM_BUILDING_PROMPTS",
            message: "正在生成包包挂件 Image 01–06 Prompt Pack…",
            error: undefined
        });
        try {
            await this.ai.openChat(this.store.get().chatUrl);
            const template = await readPrompt("bagCharm");
            const prompt = template
                .replaceAll("{{FROZEN_FACTS}}", this.frozenFacts(charm))
                .replaceAll("{{CLAIMS}}", this.claimText(charm))
                .replaceAll("{{PRODUCT_NAME}}", charm.productName.trim());
            await this.ai.sendPromptOnce(prompt, CHARM_PROMPT_PACK_FINGERPRINT);
            const text = await this.ai.waitForResponseAfterPrompt(CHARM_PROMPT_PACK_FINGERPRINT);
            const validation = validateNumberedPromptPack(text, TOTAL_CHARM_IMAGES);
            if (!validation.valid) {
                throw new Error(`Image 01–06 Prompt Pack 不完整，缺少：${validation.missing.join(", ")}`);
            }
            await mkdir(CHARM_OUTPUT_DIR, { recursive: true });
            await writeFile(path.join(CHARM_OUTPUT_DIR, "06_IMAGE_PROMPT_PACK.md"), `${text}\n`, "utf8");
            if (this.store.get().pauseRequested) {
                await this.store.update({
                    running: false,
                    stage: "PAUSED",
                    interruptedStage: "CHARM_BUILDING_PROMPTS",
                    message: "6 图 Prompt Pack 已保存，任务已安全暂停",
                    bagCharm: {
                        ...this.requireCharm(),
                        promptPackText: text,
                        promptPackValid: true
                    }
                });
                return;
            }
            await this.store.update({
                running: false,
                stage: "PAUSED",
                message: "Image 01–06 Prompt Pack 已校验，可以逐张生图",
                bagCharm: {
                    ...this.requireCharm(),
                    promptPackText: text,
                    promptPackValid: true
                }
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    /* ── 逐张生成 6 张图片（镜像内胆服务验证过的断点/恢复逻辑） ── */
    async generateImages() {
        this.assertCharmMode();
        const charm = this.requireCharm();
        if (!charm.promptPackValid || !charm.promptPackText || !this.store.get().chatUrl) {
            throw new Error("Image 01–06 Prompt Pack 尚未准备完成");
        }
        const generated = new Set(charm.generatedImageNumbers ?? []);
        await mkdir(CHARM_OUTPUT_DIR, { recursive: true });
        await this.store.update({
            running: true,
            pauseRequested: false,
            stage: "CHARM_GENERATING_IMAGES",
            message: "正在恢复对话并逐张生成包包挂件 Listing 图片…",
            error: undefined
        });
        try {
            await this.ai.openChat(this.store.get().chatUrl);
            const refImages = await scanImages(CHARM_REF_IMAGES_DIR, { preserveDuplicates: true });
            const contextImages = await scanImages(CHARM_CONTEXT_IMAGES_DIR, { preserveDuplicates: true });
            for (let number = 1; number <= TOTAL_CHARM_IMAGES; number += 1) {
                if (generated.has(number))
                    continue;
                if (this.store.get().pauseRequested) {
                    await this.store.update({
                        running: false,
                        pauseRequested: false,
                        stage: "PAUSED",
                        interruptedStage: "CHARM_GENERATING_IMAGES",
                        bagCharm: {
                            ...this.requireCharm(),
                            currentImageNumber: undefined
                        },
                        message: `任务已安全暂停，已完成 ${generated.size}/${TOTAL_CHARM_IMAGES} 张图片`
                    });
                    return;
                }
                const outputPath = path.join(CHARM_OUTPUT_DIR, `Image_${String(number).padStart(2, "0")}.png`);
                const interrupted = charm.currentImageNumber === number;
                if (interrupted &&
                    (await this.ai.saveLatestCompletedGeneratedImage(outputPath, generated.size))) {
                    generated.add(number);
                    await this.persistGenerated(generated);
                    continue;
                }
                if (interrupted &&
                    (await this.ai.hasUserPrompt(`请生成 Image ${number}`))) {
                    await this.ai.waitForGeneratedImageAndDownload(generated.size, outputPath);
                    generated.add(number);
                    await this.persistGenerated(generated);
                    continue;
                }
                await this.store.update({
                    bagCharm: { ...this.requireCharm(), currentImageNumber: number },
                    message: `正在生成包包挂件 Image ${number}/${TOTAL_CHARM_IMAGES}`
                });
                await this.ai.enableImageCreation();
                const previous = await this.ai.generatedImageCount();
                const imagePrompt = extractNumberedImagePrompt(charm.promptPackText, number, TOTAL_CHARM_IMAGES);
                const command = `请生成 Image ${number}。\n\n${imagePrompt}\n\n只生成这一张独立 1:1 正方形电商图片。不要生成其他编号，不要解释。`;
                const referenceImagePaths = charmGenerationReferenceImagePaths(number, refImages, contextImages);
                await this.ai.uploadImages(referenceImagePaths);
                await this.ai.sendPromptOnce(command, `请生成 Image ${number}`);
                await this.ai.waitForGeneratedImageAndDownload(previous, outputPath);
                generated.add(number);
                await this.persistGenerated(generated);
                if (this.store.get().pauseRequested) {
                    await this.store.update({
                        running: false,
                        pauseRequested: false,
                        stage: "PAUSED",
                        interruptedStage: "CHARM_GENERATING_IMAGES",
                        bagCharm: {
                            ...this.requireCharm(),
                            currentImageNumber: undefined
                        },
                        message: `当前图片已保存，任务已安全暂停（${generated.size}/${TOTAL_CHARM_IMAGES}）`
                    });
                    return;
                }
            }
            await this.store.update({
                running: false,
                stage: "PAUSED",
                message: "6 张图片已完成，可以继续生成包包挂件 Listing 文案",
                bagCharm: { ...this.requireCharm(), currentImageNumber: undefined }
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async persistGenerated(generated) {
        const sorted = [...generated].sort((a, b) => a - b);
        await this.store.update({
            bagCharm: {
                ...this.requireCharm(),
                generatedImageNumbers: sorted,
                outputFiles: sorted.map((item) => `Image_${String(item).padStart(2, "0")}.png`)
            }
        });
    }
    /* ── 生成 Listing 文案 ── */
    async generateListingContent() {
        this.assertCharmMode();
        const charm = this.requireCharm();
        if ((charm.generatedImageNumbers?.length ?? 0) < TOTAL_CHARM_IMAGES) {
            throw new Error("请先完成 Image 01–06 逐张生成");
        }
        if (!charm.promptPackText || !this.store.get().chatUrl) {
            throw new Error("包包挂件 Prompt Pack 或 AI 对话不存在");
        }
        await this.store.update({
            running: true,
            pauseRequested: false,
            stage: "CHARM_GENERATING_LISTING_CONTENT",
            message: "正在生成包包挂件 Listing 标题、属性词和详情页文案…",
            error: undefined
        });
        try {
            await this.ai.openChat(this.store.get().chatUrl);
            const template = await readPrompt("bagCharmListingContent");
            const prompt = [
                CHARM_LISTING_CONTENT_FINGERPRINT,
                template
                    .replaceAll("{{FROZEN_FACTS}}", this.frozenFacts(charm))
                    .replaceAll("{{CLAIMS}}", this.claimText(charm))
                    .replaceAll("{{PRODUCT_NAME}}", charm.productName?.trim() || "")
                    .replaceAll("{{PROMPT_PACK}}", charm.promptPackText)
                    .replaceAll("{{SEO_KEYWORD_REPORT}}", charm.seoKeywordReport || "（暂无 SEO 关键词报告，请基于已确认事实和常见 AliExpress / Amazon 搜索词生成）")
            ].join("\n\n");
            await this.ai.sendPromptOnce(prompt, CHARM_LISTING_CONTENT_FINGERPRINT);
            const text = await this.ai.waitForResponseAfterPrompt(CHARM_LISTING_CONTENT_FINGERPRINT);
            if (!text.includes(CHARM_LISTING_CONTENT_START) ||
                !text.includes(CHARM_LISTING_CONTENT_END)) {
                throw new Error("包包挂件 Listing 文案缺少固定边界，流程已暂停且不会自动重发");
            }
            await mkdir(CHARM_OUTPUT_DIR, { recursive: true });
            await writeFile(path.join(CHARM_OUTPUT_DIR, "07_LISTING_CONTENT.md"), `${text}\n`, "utf8");
            if (this.store.get().pauseRequested) {
                await this.store.update({
                    running: false,
                    pauseRequested: false,
                    stage: "PAUSED",
                    interruptedStage: "CHARM_GENERATING_LISTING_CONTENT",
                    message: "包包挂件 Listing 文案已保存，任务已安全暂停",
                    bagCharm: {
                        ...this.requireCharm(),
                        listingContentText: text,
                        listingContentGenerated: true
                    }
                });
                return;
            }
            await this.store.update({
                running: false,
                stage: "PAUSED",
                message: "包包挂件 Listing 文案已生成，可以归档或进入店小秘上架",
                bagCharm: {
                    ...this.requireCharm(),
                    listingContentText: text,
                    listingContentGenerated: true
                }
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async archiveCompletedCharm() {
        this.assertCharmMode();
        const charm = this.requireCharm();
        if ((charm.generatedImageNumbers?.length ?? 0) < TOTAL_CHARM_IMAGES) {
            throw new Error("请先完成 Image 01–06");
        }
        if (!charm.listingContentGenerated) {
            throw new Error("请先生成包包挂件 Listing 文案");
        }
        await this.store.update({
            running: true,
            stage: "CHARM_ARCHIVING",
            message: "正在归档包包挂件开发包…",
            error: undefined
        });
        try {
            const archiveDirectory = await this.archive();
            return await this.store.update({
                running: false,
                stage: "COMPLETED",
                message: "包包挂件设计、Listing 文案与 Image 01–06 已完成并归档",
                bagCharm: { ...this.requireCharm(), archiveDirectory }
            });
        }
        catch (error) {
            await this.fail(error);
            return this.store.get();
        }
    }
    async archive() {
        const charm = this.requireCharm();
        const name = sanitizeProductName(`${charm.productName || "Bag Charm"} 挂件`);
        let destination = path.join(COMPLETED_PRODUCTS_DIR, name);
        let suffix = 2;
        while (await readFile(path.join(destination, "run-state.json")).then(() => true).catch(() => false)) {
            destination = path.join(COMPLETED_PRODUCTS_DIR, `${name} (${suffix})`);
            suffix += 1;
        }
        await mkdir(destination, { recursive: true });
        const archivedOutput = path.join(destination, "output");
        await mkdir(archivedOutput, { recursive: true });
        const outputNames = await readdir(CHARM_OUTPUT_DIR);
        await Promise.all([
            cp(CHARM_REF_IMAGES_DIR, path.join(destination, "挂件参考图"), { recursive: true }),
            cp(CHARM_CONTEXT_IMAGES_DIR, path.join(destination, "挂件场景图"), { recursive: true }),
            ...outputNames
                .filter((imageName) => /^Image_0[1-6]\.(png|jpe?g|webp)$/i.test(imageName))
                .map((imageName) => cp(path.join(CHARM_OUTPUT_DIR, imageName), path.join(archivedOutput, imageName))),
            ...[
                "06_IMAGE_PROMPT_PACK.md",
                "07_LISTING_CONTENT.md"
            ].filter((imageName) => outputNames.includes(imageName)).map((imageName) => cp(path.join(CHARM_OUTPUT_DIR, imageName), path.join(destination, imageName)))
        ]);
        const state = this.store.get();
        await Promise.all([
            writeFile(path.join(destination, "run-state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8")
        ]);
        return destination;
    }
    /* ── 断点恢复决策 ── */
    async resume() {
        const state = this.store.get();
        const charm = state.bagCharm;
        if (!charm?.taskId)
            return;
        if (!charm.refImageNames?.length) {
            await this.store.update({
                stage: "PAUSED",
                running: false,
                message: "请先上传吊坠参考图，并填写产品名",
                error: undefined
            });
            return;
        }
        if (!charm.productName?.trim()) {
            await this.store.update({
                stage: "PAUSED",
                running: false,
                message: "请先填写产品名（PRODUCT_NAME）",
                error: undefined
            });
            return;
        }
        if (!charm.promptPackValid)
            return this.buildPromptPack();
        if (state.stage === "CHARM_BUILDING_PROMPTS")
            return this.buildPromptPack();
        if (state.stage === "CHARM_GENERATING_LISTING_CONTENT")
            return this.generateListingContent();
        if (state.stage === "CHARM_GENERATING_IMAGES" ||
            (charm.promptPackValid && (charm.generatedImageNumbers?.length ?? 0) < TOTAL_CHARM_IMAGES))
            return this.generateImages();
        if ((charm.generatedImageNumbers?.length ?? 0) >= TOTAL_CHARM_IMAGES && !charm.listingContentGenerated) {
            return this.generateListingContent();
        }
        if (charm.listingContentGenerated) {
            await this.store.update({
                stage: "PAUSED",
                running: false,
                message: "包包挂件设计与 Listing 文案已完成，请归档或进入店小秘上架",
                error: undefined
            });
            return;
        }
        await this.store.update({
            stage: "PAUSED",
            running: false,
            message: "当前包包挂件任务需要补充素材或人工确认后才能继续",
            error: undefined
        });
    }
    frozenFacts(charm) {
        return [
            `# Frozen Bag Charm Facts`,
            `Task ID: ${charm.taskId}`,
            `Product Name: ${charm.productName || "(未填)"}`,
            `Brand: ${charm.brand || "NONE"}`,
            `Type: ${charm.type || "Pendant"}`,
            `Material: ${charm.material || "(待确认)"}`,
            `Reference images: ${(charm.refImageNames || []).join(", ") || "(无)"}`,
            `Context images: ${(charm.contextImageNames || []).join(", ") || "(无)"}`
        ].join("\n");
    }
    claimText(charm) {
        const claims = charm.claims || {};
        return [
            `48h Dispatch: ${claims.dispatch48h ? "allowed" : "not allowed"}`,
            `7-Day Returns: ${claims.returns7Day ? "allowed" : "not allowed"}`
        ].join("\n");
    }
}
export function charmGenerationReferenceImagePaths(imageNumber, refImages, contextImages) {
    if (!refImages.length)
        throw new Error("请先上传吊坠参考图");
    const useContext = imageNumber === 1 || imageNumber === 3;
    const contextPaths = useContext ? contextImages.map((image) => image.path) : [];
    return [...refImages.map((image) => image.path), ...contextPaths];
}
//# sourceMappingURL=bag-charm-service.js.map
