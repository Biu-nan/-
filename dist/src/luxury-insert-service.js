import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { jsonrepair } from "jsonrepair";
import { chromium } from "playwright-core";
import { CHROME_PATH, COMPLETED_PRODUCTS_DIR, GOOGLE_SHEETS_WEBHOOK_CONFIG_FILE, INSERT_BAG_IMAGES_DIR, INSERT_LINER_IMAGES_DIR, INSERT_OUTPUT_DIR, INSERT_STOCK_SHEET_RECORDS_FILE } from "./config.js";
import { importImagesToDirectory, importImageUrlsToDirectory, scanImages } from "./directory-images.js";
import { extractNumberedImagePrompt, readPrompt, validateNumberedPromptPack } from "./prompt-files.js";
import { sanitizeProductName } from "./product-session.js";
import { assertPublicHost, scanProductImages } from "./image-files.js";
const IDENTIFICATION_FINGERPRINT = "# 奢侈包内胆目标外包识别";
const MARKET_RADAR_FINGERPRINT = "# 全网热销包型机会雷达 Agent v0.3";
const HANDOFF_FINGERPRINT = "# 奢侈包内胆任务迁移";
const INSERT_LISTING_CONTENT_FINGERPRINT = "# Luxury Bag Organizer Listing Content";
const NOTEBOOK_START = "<<<NOTEBOOK_INSERT_PLAN_START>>>";
const NOTEBOOK_END = "<<<NOTEBOOK_INSERT_PLAN_END>>>";
const NOTEBOOK_DATA_START = "<<<NOTEBOOK_INSERT_DATA_START>>>";
const NOTEBOOK_DATA_END = "<<<NOTEBOOK_INSERT_DATA_END>>>";
const IDENTIFICATION_DATA_START = "<<<BAG_IDENTIFICATION_DATA_START>>>";
const IDENTIFICATION_DATA_END = "<<<BAG_IDENTIFICATION_DATA_END>>>";
const MARKET_RADAR_DATA_START = "<<<MARKET_RADAR_DATA_START>>>";
const MARKET_RADAR_DATA_END = "<<<MARKET_RADAR_DATA_END>>>";
const INSERT_LISTING_CONTENT_START = "<<<INSERT_LISTING_CONTENT_START>>>";
const INSERT_LISTING_CONTENT_END = "<<<INSERT_LISTING_CONTENT_END>>>";
const INSERT_STOCK_SHEET_URL = "https://docs.google.com/spreadsheets/d/1iz1-TtBiqv075ZO3HlLjeW36OptwJfGlHApp1ljOP6A/edit";
const INSERT_STOCK_SHEET_NAME = "工作表1";
function parseAiJson(raw, label) {
    const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'");
    const objectStart = cleaned.indexOf("{");
    const objectEnd = cleaned.lastIndexOf("}");
    const candidate = objectStart >= 0 && objectEnd > objectStart
        ? cleaned.slice(objectStart, objectEnd + 1)
        : cleaned;
    try {
        return JSON.parse(candidate);
    }
    catch {
        try {
            return JSON.parse(jsonrepair(candidate));
        }
        catch {
            throw new Error(`${label}不是有效 JSON，无法自动回填`);
        }
    }
}
export function parseBagIdentificationData(text) {
    const start = text.indexOf(IDENTIFICATION_DATA_START);
    const end = text.indexOf(IDENTIFICATION_DATA_END, start + IDENTIFICATION_DATA_START.length);
    if (start === -1 || end === -1) {
        throw new Error("识别回复缺少包型尺寸结构化数据，无法自动回填");
    }
    const raw = text.slice(start + IDENTIFICATION_DATA_START.length, end);
    const value = parseAiJson(raw, "包型尺寸结构化数据");
    if (!value || typeof value !== "object") {
        throw new Error("包型尺寸结构化数据格式无效");
    }
    const data = value;
    const brand = String(data.brand ?? "").trim();
    const bagFamily = String(data.bagFamily ?? "").trim();
    const primaryVariantId = String(data.primaryVariantId ?? "").trim();
    const rawVariants = Array.isArray(data.variants) ? data.variants : [];
    const variants = rawVariants.map((item, index) => {
        const variant = (item ?? {});
        const dimensions = (variant.bagDimensions ?? {});
        return {
            id: String(variant.id ?? `SKU-${index + 1}`).trim(),
            label: String(variant.label ?? "").trim(),
            bagDimensions: {
                length: Number(dimensions.length),
                width: Number(dimensions.width),
                height: Number(dimensions.height)
            },
            publicSourceUrl: String(variant.publicSourceUrl ?? "").trim(),
            version: String(variant.version ?? "").trim(),
            confidence: String(variant.confidence ?? "").trim()
        };
    });
    if (!brand || !bagFamily || !variants.length) {
        throw new Error("识别数据缺少品牌、包型或尺寸 SKU");
    }
    if (!variants.some((variant) => variant.id === primaryVariantId)) {
        throw new Error("识别数据中的主推 SKU 不在候选列表中");
    }
    for (const variant of variants) {
        if (!variant.id ||
            !variant.label ||
            [
                variant.bagDimensions.length,
                variant.bagDimensions.width,
                variant.bagDimensions.height
            ].some((number) => !Number.isFinite(number) || number <= 0)) {
            throw new Error(`识别数据中的 ${variant.id || "SKU"} 尺寸不完整`);
        }
    }
    return { brand, bagFamily, primaryVariantId, variants };
}
function stringArray(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item ?? "").trim()).filter(Boolean);
    }
    const text = String(value ?? "").trim();
    return text ? [text] : [];
}
function enumValue(value, allowed, label) {
    const text = String(value ?? "").trim();
    if (allowed.includes(text))
        return text;
    throw new Error(`市场雷达候选缺少有效的 ${label}`);
}
function candidateIdFor(data) {
    return createHash("sha256")
        .update([
        data.bagModel.toLowerCase(),
        data.sizeVersion.toLowerCase(),
        data.officialProductUrl.toLowerCase()
    ].join("|"))
        .digest("hex")
        .slice(0, 16);
}
function isHttpUrl(value) {
    return /^https?:\/\//i.test(value.trim());
}
function looksLikeImageUrl(value) {
    return /^https?:\/\/.+\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(value.trim());
}
export function parseMarketRadarCandidates(text) {
    const start = text.indexOf(MARKET_RADAR_DATA_START);
    const end = text.indexOf(MARKET_RADAR_DATA_END, start + MARKET_RADAR_DATA_START.length);
    if (start === -1 || end === -1) {
        throw new Error("市场雷达回复缺少开发候选结构化数据，无法选择包型继续");
    }
    const raw = text.slice(start + MARKET_RADAR_DATA_START.length, end);
    const value = parseAiJson(raw, "市场雷达开发候选结构化数据");
    if (!value || typeof value !== "object") {
        throw new Error("市场雷达开发候选结构化数据格式无效");
    }
    const rawCandidates = value.candidates;
    if (!Array.isArray(rawCandidates) || !rawCandidates.length) {
        throw new Error("市场雷达结构化数据缺少 candidates 数组");
    }
    const seen = new Set();
    const candidates = rawCandidates.map((item, index) => {
        const data = (item ?? {});
        const bagModel = String(data.bagModel ?? "").trim();
        const brand = String(data.brand ?? "").trim();
        const bagFamily = String(data.bagFamily ?? bagModel).trim();
        const sizeVersion = String(data.sizeVersion ?? "").trim();
        const rawOfficialProductUrl = String(data.officialProductUrl ?? "").trim();
        const rawOfficialFrontImageUrl = String(data.officialFrontImageUrl ?? "").trim();
        /* 保留图片字段原始值（UI 自行判断是否为图片直链）。
           若 AI 把产品页 / 品牌页 URL 错放进图片字段，则救回到 officialProductUrl，
           避免链接被误判为 “Not found” 而永久丢失。 */
        const officialFrontImageUrl = rawOfficialFrontImageUrl;
        const officialProductUrl = rawOfficialProductUrl ||
            (isHttpUrl(rawOfficialFrontImageUrl) && !looksLikeImageUrl(rawOfficialFrontImageUrl)
                ? rawOfficialFrontImageUrl
                : "");
        if (!bagModel || !brand || !bagFamily) {
            throw new Error(`市场雷达候选 ${index + 1} 缺少包型、品牌或包型家族`);
        }
        const candidateId = candidateIdFor({
            bagModel,
            sizeVersion,
            officialProductUrl
        });
        if (seen.has(candidateId)) {
            throw new Error(`市场雷达候选重复：${bagModel} ${sizeVersion}`);
        }
        seen.add(candidateId);
        return {
            candidateId,
            rank: Number(data.rank) || index + 1,
            bagModel,
            brand,
            bagFamily,
            sizeVersion,
            parentCategory: String(data.parentCategory ?? "").trim(),
            evidenceLevel: enumValue(data.evidenceLevel, ["E1", "E2", "E3", "E4", "E5"], "Evidence Level"),
            heatType: String(data.heatType ?? "").trim(),
            nativeOrganizationLevel: enumValue(data.nativeOrganizationLevel, ["High", "Medium", "Low", "Unknown"], "Native Organization Level"),
            builtInFeatures: stringArray(data.builtInFeatures),
            painGap: String(data.painGap ?? "").trim(),
            insertValueType: stringArray(data.insertValueType),
            organizerPotential: enumValue(data.organizerPotential, ["High", "Medium", "Low"], "Organizer Potential"),
            inventoryReusePotential: enumValue(data.inventoryReusePotential, ["High", "Medium", "Low", "Unknown"], "Inventory Reuse Potential"),
            riskFlags: stringArray(data.riskFlags),
            officialFrontImageUrl,
            officialProductUrl,
            listingSafeAngle: String(data.listingSafeAngle ?? "").trim(),
            poolTier: enumValue(data.poolTier, ["P0", "P1", "P2", "Reject"], "Pool Tier"),
            nextStep: String(data.nextStep ?? "").trim(),
            sourceEvidence: String(data.sourceEvidence ?? "").trim(),
            whyP0: String(data.whyP0 ?? "").trim()
        };
    });
    return candidates.sort((a, b) => a.rank - b.rank);
}
export function insertDimensionConflict(variant) {
    if (!variant.insertDimensions)
        return `${variant.label} 缺少内胆尺寸`;
    const bag = variant.bagDimensions;
    const liner = variant.insertDimensions;
    if (liner.length > bag.length ||
        liner.width > bag.width ||
        liner.height > bag.height) {
        return `${variant.label} 内胆尺寸超出外包尺寸`;
    }
    return undefined;
}
export function resetInsertMarketRadarState(_insert) {
    return undefined;
}
export function insertGenerationReferenceImagePaths(insert, imageNumber, bagImages, linerImages) {
    if (!bagImages.length)
        throw new Error("请先上传目标外包参考图");
    const variants = insert.variants ?? [];
    if (!variants.length)
        throw new Error("缺少已冻结的内胆 SKU");
    const primary = variants.find((variant) => variant.id === insert.primaryVariantId);
    if (!primary)
        throw new Error("缺少主推 SKU，无法选择内胆参考图");
    const requiredVariants = imageNumber === 7 ? variants : [primary];
    const linerByName = new Map(linerImages.map((image) => [image.name, image.path]));
    const requiredLinerPaths = requiredVariants.map((variant) => {
        if (!variant.linerImageName || !linerByName.has(variant.linerImageName)) {
            throw new Error(`${variant.label} 缺少内胆参考图`);
        }
        return linerByName.get(variant.linerImageName);
    });
    /* ── 收集所有相关 SKU 的细节图路径（每张都作为额外参考传给 AI） ── */
    const detailPaths = [];
    for (const variant of requiredVariants) {
        const detailNames = variant.linerDetailImageNames ?? [];
        for (const name of detailNames) {
            const path = linerByName.get(name);
            if (path)
                detailPaths.push(path);
        }
    }
    return [
        ...bagImages.map((image) => image.path),
        ...requiredLinerPaths,
        ...detailPaths
    ];
}
export function parseNotebookInsertData(text, existingVariants) {
    const start = text.indexOf(NOTEBOOK_DATA_START);
    const end = text.indexOf(NOTEBOOK_DATA_END, start + NOTEBOOK_DATA_START.length);
    if (start === -1 || end === -1) {
        throw new Error("NotebookLM 回复缺少内胆方案结构化数据，无法自动回填");
    }
    const raw = text.slice(start + NOTEBOOK_DATA_START.length, end);
    const value = parseAiJson(raw, "NotebookLM 内胆方案结构化数据");
    if (!value || typeof value !== "object") {
        throw new Error("NotebookLM 内胆方案结构化数据格式无效");
    }
    const rawVariants = value.variants;
    if (!Array.isArray(rawVariants)) {
        throw new Error("NotebookLM 内胆方案缺少 variants 数组");
    }
    const existingById = new Map(existingVariants.map((variant) => [variant.id, variant]));
    const returnedIds = new Set();
    const planned = rawVariants.map((item) => {
        const data = (item ?? {});
        const id = String(data.id ?? "").trim();
        const existing = existingById.get(id);
        if (!existing)
            throw new Error(`NotebookLM 返回了未知 SKU：${id || "空编号"}`);
        if (returnedIds.has(id))
            throw new Error(`NotebookLM 重复返回 SKU：${id}`);
        returnedIds.add(id);
        const dimensions = (data.insertDimensions ?? {});
        const decision = String(data.designDecision ?? "").trim();
        if (decision !== "REUSE_STOCK" && decision !== "NEW_DESIGN") {
            throw new Error(`${id} 缺少有效的库存复用/新开发结论`);
        }
        const weightValue = data.weightGrams;
        const weight = weightValue === null || weightValue === undefined || weightValue === ""
            ? undefined
            : Number(weightValue);
        const merged = {
            ...existing,
            insertDimensions: {
                length: Number(dimensions.length),
                width: Number(dimensions.width),
                height: Number(dimensions.height)
            },
            inventorySku: String(data.inventorySku ?? "").trim(),
            material: String(data.material ?? "").trim(),
            color: String(data.color ?? "").trim(),
            structure: String(data.structure ?? "").trim(),
            weightGrams: weight,
            designDecision: decision,
            fitClearance: String(data.fitClearance ?? "").trim(),
            designRisks: String(data.designRisks ?? "").trim()
        };
        const numbers = [
            merged.insertDimensions.length,
            merged.insertDimensions.width,
            merged.insertDimensions.height
        ];
        if (numbers.some((number) => !Number.isFinite(number) || number <= 0)) {
            throw new Error(`${id} 的内胆尺寸不完整`);
        }
        if (weight !== undefined && (!Number.isFinite(weight) || weight <= 0)) {
            throw new Error(`${id} 的重量必须为大于 0 的数值或 null`);
        }
        const conflict = insertDimensionConflict(merged);
        if (conflict)
            throw new Error(conflict);
        return merged;
    });
    const missing = existingVariants
        .filter((variant) => !returnedIds.has(variant.id))
        .map((variant) => variant.id);
    if (missing.length) {
        throw new Error(`NotebookLM 内胆方案缺少 SKU：${missing.join("、")}`);
    }
    return planned;
}
export class LuxuryInsertService {
    store;
    adapters;
    notebook;
    constructor(store, adapters, notebook) {
        this.store = store;
        this.adapters = adapters;
        this.notebook = notebook;
    }
    get ai() {
        return this.adapters[this.store.get().provider];
    }
    async selectMode(mode) {
        const state = this.store.get();
        if (state.running || state.autoRun)
            throw new Error("流程运行中，不能切换业务模式");
        if (state.workflowMode === mode)
            return state;
        if (state.chatUrl || state.completedPhase || state.luxuryInsert?.taskId) {
            const staleFailedStandardState = state.workflowMode === "standard_listing" &&
                mode === "luxury_insert" &&
                state.stage === "FAILED" &&
                (await scanProductImages()).length === 0;
            if (!staleFailedStandardState) {
                throw new Error("当前商品已开始，请归档或清空后再切换业务模式");
            }
        }
        /* 切换模式时保留选款雷达结果，仅清空当前商品进度字段 */
        const preservedRadar = state.luxuryInsert
            ? {
                marketRadarCandidates: state.luxuryInsert.marketRadarCandidates,
                marketRadarText: state.luxuryInsert.marketRadarText,
                marketRadarUpdatedAt: state.luxuryInsert.marketRadarUpdatedAt,
                marketRadarChatUrl: state.luxuryInsert.marketRadarChatUrl,
                selectedMarketRadarCandidateId: state.luxuryInsert.selectedMarketRadarCandidateId
            }
            : undefined;
        return this.store.update({
            workflowMode: mode,
            standardWorkflowGoal: "full_listing",
            researchCompleted: false,
            stage: "IDLE",
            chatUrl: undefined,
            completedPhase: undefined,
            responseText: undefined,
            researchText: undefined,
            planningText: undefined,
            promptPackValid: undefined,
            generatedImageNumbers: [],
            outputFiles: [],
            luxuryInsert: preservedRadar,
            message: mode === "luxury_insert"
                ? "已切换到奢侈包内胆设计模式"
                : "已切换到标准 Listing 模式",
            error: undefined
        });
    }
    async selectProvider(provider) {
        const previous = this.store.get();
        if (previous.running || previous.autoRun)
            throw new Error("流程运行中，不能切换 AI 引擎");
        if (previous.provider === provider)
            return previous;
        await this.store.update({
            provider,
            browserStarted: false,
            chatUrl: undefined,
            stage: "READY_FOR_LOGIN",
            message: `已切换到 ${this.providerName(provider)}，正在迁移内胆任务上下文…`
        });
        const adapter = this.adapters[provider];
        const page = await adapter.launch();
        const readiness = await adapter.checkReady();
        if (!readiness.ready) {
            return this.store.update({
                browserStarted: true,
                message: `请先登录 ${this.providerName(provider)}，登录后重新检查连接`
            });
        }
        if (!previous.luxuryInsert?.taskId)
            return this.store.get();
        const bagImages = await scanImages(INSERT_BAG_IMAGES_DIR);
        const linerImages = await scanImages(INSERT_LINER_IMAGES_DIR, {
            preserveDuplicates: true
        });
        await adapter.createBlankChat();
        if (bagImages.length)
            await adapter.uploadImages(bagImages.map((image) => image.path));
        if (linerImages.length)
            await adapter.uploadImages(linerImages.map((image) => image.path));
        const context = [
            HANDOFF_FINGERPRINT,
            `Task ID: ${previous.luxuryInsert.taskId}`,
            previous.luxuryInsert.identificationText ?? "",
            previous.luxuryInsert.notebookResultText ?? "",
            previous.luxuryInsert.promptPackText ?? "",
            "请只回复：已接收当前内胆任务上下文。"
        ].join("\n\n");
        await adapter.sendPromptOnce(context, HANDOFF_FINGERPRINT);
        await adapter.waitForResponseAfterPrompt(HANDOFF_FINGERPRINT);
        return this.store.update({
            chatUrl: adapter.currentUrl(),
            browserStarted: true,
            stage: "PAUSED",
            message: `已切换到 ${this.providerName(provider)}，可继续内胆任务`,
            error: undefined
        });
    }
    async runMarketRadar() {
        this.assertLuxuryMode();
        const state = this.store.get();
        if (state.running)
            throw new Error("当前已有任务正在运行");
        /* ── 磁盘兜底：state 丢失但磁盘有数据时自动恢复，不重复跑雷达 ── */
        const recovered = await this.recoverMarketRadarFromDisk();
        if (recovered)
            return { recovered: true };
        await this.store.update({
            running: true,
            pauseRequested: false,
            stage: "INSERT_MARKET_RADAR",
            message: "正在执行每日市场选款雷达，全网搜索热销包型机会…",
            error: undefined,
            luxuryInsert: {
                ...state.luxuryInsert
            }
        });
        try {
            const readiness = await this.ai.checkReady();
            if (!readiness.ready)
                throw new Error(`${this.providerName(state.provider)} 尚未登录`);
            await this.ai.createBlankChat();
            try {
                await this.ai.enableWebSearch();
            }
            catch (webSearchError) {
                console.warn("[market-radar] enableWebSearch 失败，继续发送 Prompt:", webSearchError instanceof Error ? webSearchError.message : String(webSearchError));
            }
            const prompt = await readPrompt("insertMarketRadar");
            await this.ai.sendPromptOnce(prompt, MARKET_RADAR_FINGERPRINT);
            const text = await this.waitForMarketRadarResponse();
            const candidates = await this.saveMarketRadarResult(text);
            await this.store.update({
                running: false,
                stage: "PAUSED",
                message: "每日市场选款雷达已完成，开发建议已回传并保存",
                luxuryInsert: {
                    ...this.store.get().luxuryInsert,
                    marketRadarText: text,
                    marketRadarUpdatedAt: new Date().toISOString(),
                    marketRadarChatUrl: this.ai.currentUrl(),
                    marketRadarCandidates: candidates
                }
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async selectMarketRadarCandidate(candidateId) {
        this.assertLuxuryMode();
        const state = this.store.get();
        if (state.running)
            throw new Error("流程运行中，不能选择开发包型");
        if (state.luxuryInsert?.bagFactsConfirmed || state.luxuryInsert?.designFrozen) {
            throw new Error("当前内胆任务已锁定，请先遗弃或开始下一个任务");
        }
        const candidates = state.luxuryInsert?.marketRadarCandidates ?? [];
        const candidate = candidates.find((item) => item.candidateId === candidateId);
        if (!candidate)
            throw new Error("未找到该市场雷达候选包型");
        const importResult = await this.importMarketRadarCandidateBagImage(candidate);
        const warning = importResult.warning;
        const summary = this.marketRadarCandidateSummary(candidate, warning);
        return this.store.update({
            stage: "PAUSED",
            message: warning
                ? "已从市场雷达创建开发任务，但目标外包图需要人工确认"
                : "已从市场雷达创建开发任务，请继续识别包型并核对公开尺寸",
            error: undefined,
            luxuryInsert: {
                ...state.luxuryInsert,
                taskId: state.luxuryInsert?.taskId ?? this.taskId(),
                selectedMarketRadarCandidateId: candidate.candidateId,
                marketRadarSelectionWarning: warning,
                brand: candidate.brand,
                bagFamily: candidate.bagFamily || candidate.bagModel,
                publicDimensionSourcesText: summary,
                variants: undefined,
                primaryVariantId: undefined,
                bagFactsConfirmed: false,
                notebookInputText: undefined,
                notebookResultText: undefined,
                designFrozen: false,
                claims: undefined,
                promptPackText: undefined,
                promptPackValid: false,
                linerImagesUploaded: false,
                generatedImageNumbers: [],
                outputFiles: [],
                currentImageNumber: undefined
            }
        });
    }
    async importBagImageUrls(rawUrls) {
        this.assertLuxuryMode();
        const urls = [...new Set(rawUrls.map((url) => url.trim()).filter(Boolean))];
        if (!urls.length)
            throw new Error("请至少输入一个图片 URL 或产品页 URL");
        if (urls.length > 12)
            throw new Error("一次最多导入 12 个 URL");
        const result = {
            imported: [],
            skippedDuplicates: [],
            rejected: []
        };
        for (let index = 0; index < urls.length; index += 1) {
            const url = urls[index];
            const preferredName = `bag-url-${index + 1}`;
            const imported = await this.importResolvedBagImageFromUrl(url, preferredName, result);
            if (!imported)
                result.rejected.push(url);
        }
        return result;
    }
    async returnToMarketRadarPool() {
        this.assertLuxuryMode();
        const state = this.store.get();
        const insert = state.luxuryInsert;
        if (state.running)
            throw new Error("流程运行中，不能返回市场雷达候选池");
        if (!insert?.marketRadarCandidates?.length) {
            throw new Error("当前没有可返回的市场雷达候选结果");
        }
        await this.archiveRollbackArtifacts("market-radar");
        await Promise.all([
            rm(INSERT_BAG_IMAGES_DIR, { recursive: true, force: true }),
            rm(INSERT_LINER_IMAGES_DIR, { recursive: true, force: true })
        ]);
        await Promise.all([
            mkdir(INSERT_BAG_IMAGES_DIR, { recursive: true }),
            mkdir(INSERT_LINER_IMAGES_DIR, { recursive: true })
        ]);
        return this.store.update({
            stage: "PAUSED",
            message: "已放弃当前包型开发，返回市场雷达候选池",
            error: undefined,
            responseText: insert.marketRadarText,
            luxuryInsert: {
                marketRadarText: insert.marketRadarText,
                marketRadarUpdatedAt: insert.marketRadarUpdatedAt,
                marketRadarChatUrl: insert.marketRadarChatUrl,
                marketRadarCandidates: insert.marketRadarCandidates,
                selectedMarketRadarCandidateId: undefined,
                marketRadarSelectionWarning: undefined
            }
        });
    }
    async resetMarketRadar() {
        this.assertLuxuryMode();
        const state = this.store.get();
        const insert = state.luxuryInsert;
        if (state.running)
            throw new Error("流程运行中，不能重置每日市场选款");
        if (insert?.selectedMarketRadarCandidateId ||
            insert?.bagFactsConfirmed ||
            insert?.designFrozen ||
            insert?.promptPackValid ||
            (insert?.generatedImageNumbers?.length ?? 0) > 0) {
            throw new Error("当前内胆任务已开始，请先返回候选池、遗弃或归档后再重置每日选款");
        }
        return this.store.update({
            stage: "PAUSED",
            message: "每日市场选款已手动重置，可以重新执行市场雷达",
            error: undefined,
            responseText: undefined,
            luxuryInsert: resetInsertMarketRadarState(insert)
        });
    }
    async saveMarketRadarResult(text) {
        await mkdir(INSERT_OUTPUT_DIR, { recursive: true });
        /* ── 先解析候选，再原子写入状态 + 文件 ── */
        const candidates = parseMarketRadarCandidates(text);
        /* 写入磁盘文件 */
        await Promise.all([
            writeFile(path.join(INSERT_OUTPUT_DIR, "00_DAILY_MARKET_RADAR.md"), `${text}\n`, "utf8"),
            writeFile(path.join(INSERT_OUTPUT_DIR, "00_DAILY_MARKET_RADAR_DATA.json"), `${JSON.stringify({ candidates }, null, 2)}\n`, "utf8")
        ]);
        /* 原子写入 run-state：不清 candidates 再恢复（避免两阶段之间被杀导致丢失） */
        await this.store.update({
            luxuryInsert: {
                ...this.store.get().luxuryInsert,
                marketRadarText: text,
                marketRadarUpdatedAt: new Date().toISOString(),
                marketRadarChatUrl: this.ai.currentUrl(),
                marketRadarCandidates: candidates,
                selectedMarketRadarCandidateId: undefined,
                marketRadarSelectionWarning: undefined
            }
        });
        return candidates;
    }
    /* ── 从当前 ChatGPT 页面救回市场雷达答案（已生成但流程因导航/超时而丢失时） ── */
    async importMarketRadarFromCurrentChat() {
        this.assertLuxuryMode();
        const state = this.store.get();
        if (state.running)
            throw new Error("当前内胆流程正在运行，不能导入");
        const readiness = await this.ai.checkReady();
        if (!readiness.ready)
            throw new Error(`${this.providerName(state.provider)} 尚未登录`);
        const text = await this.ai.recoverCompletedResponse(MARKET_RADAR_FINGERPRINT);
        if (!text)
            throw new Error("当前 ChatGPT 会话中未找到市场雷达结果（请确认页面已包含 # 全网热销包型机会雷达 Agent v0.3 的提示及回复）");
        const candidates = await this.saveMarketRadarResult(text);
        return this.store.update({
            running: false,
            stage: "PAUSED",
            message: "已从当前 ChatGPT 对话导入每日市场选款雷达结果",
            error: undefined,
            luxuryInsert: {
                ...this.store.get().luxuryInsert,
                marketRadarText: text,
                marketRadarUpdatedAt: new Date().toISOString(),
                marketRadarChatUrl: this.ai.currentUrl(),
                marketRadarCandidates: candidates
            }
        });
    }
    /* ── 从当前 ChatGPT 页面救回内胆 Listing 文案（已生成但缺少边界导致未保存时） ── */
    async importInsertListingContentFromCurrentChat() {
        this.assertLuxuryMode();
        const state = this.store.get();
        if (state.running)
            throw new Error("当前内胆流程正在运行，不能导入");
        const insert = this.requireInsert();
        if ((insert.generatedImageNumbers?.length ?? 0) < 7)
            throw new Error("请先完成 Image 01–07");
        const readiness = await this.ai.checkReady();
        if (!readiness.ready)
            throw new Error(`${this.providerName(state.provider)} 尚未登录`);
        let text = await this.ai.recoverCompletedResponse(INSERT_LISTING_CONTENT_FINGERPRINT);
        if (!text)
            throw new Error("当前 ChatGPT 会话中未找到内胆 Listing 文案（请确认页面已包含 # Luxury Bag Organizer Listing Content 的提示及回复）");
        /* 导入路径放宽边界检查：没有边界时自动包裹，避免已生成内容被丢弃 */
        if (!text.includes(INSERT_LISTING_CONTENT_START) || !text.includes(INSERT_LISTING_CONTENT_END)) {
            text = `${INSERT_LISTING_CONTENT_START}\n\n${text.trim()}\n\n${INSERT_LISTING_CONTENT_END}`;
        }
        await mkdir(INSERT_OUTPUT_DIR, { recursive: true });
        await writeFile(path.join(INSERT_OUTPUT_DIR, "07_LISTING_CONTENT.md"), `${text}\n`, "utf8");
        return this.store.update({
            running: false,
            stage: "PAUSED",
            message: "已从当前 ChatGPT 对话导入内胆 Listing 文案",
            error: undefined,
            luxuryInsert: {
                ...this.store.get().luxuryInsert,
                listingContentText: text,
                listingContentGenerated: true,
                listingContentChatUrl: this.ai.currentUrl()
            }
        });
    }
    /* ── 磁盘兜底：当 run-state.json 中雷达候选丢失但从磁盘文件可恢复时，自动恢复 ── */
    async recoverMarketRadarFromDisk() {
        const state = this.store.get();
        const insert = state.luxuryInsert || {};
        /* 已有候选则无需恢复 */
        if (Array.isArray(insert.marketRadarCandidates) && insert.marketRadarCandidates.length > 0)
            return false;
        const dataPath = path.join(INSERT_OUTPUT_DIR, "00_DAILY_MARKET_RADAR_DATA.json");
        const mdPath = path.join(INSERT_OUTPUT_DIR, "00_DAILY_MARKET_RADAR.md");
        try {
            const [dataRaw, mdRaw] = await Promise.all([
                readFile(dataPath, "utf8").catch(() => null),
                readFile(mdPath, "utf8").catch(() => null)
            ]);
            if (!dataRaw)
                return false;
            const { candidates } = JSON.parse(dataRaw);
            if (!Array.isArray(candidates) || candidates.length === 0)
                return false;
            await this.store.update({
                luxuryInsert: {
                    ...this.store.get().luxuryInsert,
                    marketRadarText: mdRaw || (insert.marketRadarText || ""),
                    marketRadarUpdatedAt: (insert.marketRadarUpdatedAt || new Date()).toISOString(),
                    marketRadarCandidates: candidates
                }
            });
            return true;
        } catch {
            return false;
        }
    }
    /* ── 修复：用已落盘的原始雷达文本重新解析，补回被误丢的产品页链接（不改 candidateId，避免破坏已选状态） ── */
    async repairMarketRadarProductUrls() {
        const state = this.store.get();
        const insert = state.luxuryInsert || {};
        const text = insert.marketRadarText;
        const existing = Array.isArray(insert.marketRadarCandidates) ? insert.marketRadarCandidates : [];
        if (!existing.length || !text) {
            return { repaired: 0, total: existing.length, skipped: true };
        }
        let fresh;
        try {
            fresh = parseMarketRadarCandidates(text);
        } catch (e) {
            return { repaired: 0, total: existing.length, error: String(e.message || e) };
        }
        const byKey = new Map();
        for (const f of fresh) {
            byKey.set(`${f.bagModel}|${f.sizeVersion}`.toLowerCase(), f);
        }
        let repaired = 0;
        const updated = existing.map((c) => {
            const key = `${c.bagModel}|${c.sizeVersion}`.toLowerCase();
            const f = byKey.get(key);
            if (!f)
                return c;
            const productUrl = c.officialProductUrl || f.officialProductUrl || "";
            const imageUrl = c.officialFrontImageUrl || f.officialFrontImageUrl || "";
            const changed = (!c.officialProductUrl && f.officialProductUrl) ||
                (!c.officialFrontImageUrl && f.officialFrontImageUrl);
            if (changed)
                repaired++;
            return { ...c, officialProductUrl: productUrl, officialFrontImageUrl: imageUrl };
        });
        await this.store.update({
            luxuryInsert: { ...this.store.get().luxuryInsert, marketRadarCandidates: updated }
        });
        return { repaired, total: updated.length };
    }
    async waitForMarketRadarResponse() {
        let text = await this.ai.waitForResponseAfterPrompt(MARKET_RADAR_FINGERPRINT);
        if (text.includes(MARKET_RADAR_DATA_START) && text.includes(MARKET_RADAR_DATA_END)) {
            return text;
        }
        const deadline = Date.now() + 10 * 60_000;
        let lastText = text;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 5_000));
            const recovered = await this.ai.recoverCompletedResponse(MARKET_RADAR_FINGERPRINT);
            if (recovered) {
                lastText = recovered;
                if (recovered.includes(MARKET_RADAR_DATA_START) &&
                    recovered.includes(MARKET_RADAR_DATA_END)) {
                    return recovered;
                }
            }
        }
        return lastText;
    }
    async identifyBag() {
        this.assertLuxuryMode();
        const state = this.store.get();
        if (state.running)
            throw new Error("当前已有任务正在运行");
        const images = await scanImages(INSERT_BAG_IMAGES_DIR);
        if (!images.length)
            throw new Error("请先上传至少一张目标外包图片");
        await this.store.update({
            running: true,
            pauseRequested: false,
            stage: "INSERT_IDENTIFYING_BAG",
            message: "正在识别品牌、包型、版本并联网核对公开尺寸…",
            error: undefined,
            startedAt: new Date().toISOString(),
            luxuryInsert: {
                ...state.luxuryInsert,
                taskId: state.luxuryInsert?.taskId ?? this.taskId(),
                generatedImageNumbers: [],
                outputFiles: []
            }
        });
        try {
            const readiness = await this.ai.checkReady();
            if (!readiness.ready)
                throw new Error(`${this.providerName(state.provider)} 尚未登录`);
            await this.ai.createBlankChat();
            await this.ai.uploadImages(images.map((image) => image.path));
            await this.ai.enableWebSearch();
            const prompt = `${IDENTIFICATION_FINGERPRINT}

请基于上传的目标奢侈包图片识别品牌、包型家族、尺寸版本候选与年份/版本差异，并联网搜索品牌官网、官方产品页或可信尺寸来源核对公开外部尺寸。

要求：
- 图片是包型与外观事实的最高优先级来源。
- 不得把相似包型当成确定事实。
- 一个任务只保留同一包型家族，可列出 Mini/Small/Medium/Large 等多个尺寸候选。
- 每个候选输出长、宽、高（cm）、原始来源尺寸、来源 URL、来源类型、置信度与冲突项。
- 明确推荐市场最主流的一个尺寸作为 Primary SKU，但最终由用户确认。
- 不生成内胆尺寸，不生成图片。

先输出方便人工阅读的结构化 Markdown 报告。

然后必须在回复末尾输出以下固定边界和严格 JSON，不要添加注释，不要省略字段：

${IDENTIFICATION_DATA_START}
{
  "brand": "品牌英文名",
  "bagFamily": "包型家族英文名",
  "primaryVariantId": "SKU-2",
  "variants": [
    {
      "id": "SKU-1",
      "label": "Mini",
      "bagDimensions": {
        "length": 18,
        "width": 8,
        "height": 12.5
      },
      "publicSourceUrl": "https://可信来源页面",
      "version": "版本或年份备注",
      "confidence": "High"
    }
  ]
}
${IDENTIFICATION_DATA_END}

规则：
- JSON 数值统一为厘米，不要在数值中包含单位。
- variants 只保留同一包型家族中能够获得完整长宽高的候选。
- id 必须唯一且从 SKU-1 顺序编号。
- primaryVariantId 必须与 variants 中一个 id 完全一致。
- 无法确认品牌、包型或完整尺寸时不要猜测，明确说明后仍输出最可靠候选。`;
            await this.ai.sendPromptOnce(prompt, IDENTIFICATION_FINGERPRINT);
            const text = await this.ai.waitForResponseAfterPrompt(IDENTIFICATION_FINGERPRINT);
            await this.store.update({
                responseText: text,
                chatUrl: this.ai.currentUrl(),
                luxuryInsert: {
                    ...this.requireInsert(),
                    identificationText: text,
                    publicDimensionSourcesText: text
                }
            });
            const identification = parseBagIdentificationData(text);
            await this.store.update({
                running: false,
                chatUrl: this.ai.currentUrl(),
                stage: "INSERT_WAITING_BAG_CONFIRMATION",
                message: "识别结果已自动回填，请核对后点击确认",
                responseText: text,
                luxuryInsert: {
                    ...this.store.get().luxuryInsert,
                    identificationText: text,
                    publicDimensionSourcesText: text,
                    brand: identification.brand,
                    bagFamily: identification.bagFamily,
                    variants: identification.variants,
                    primaryVariantId: identification.primaryVariantId,
                    bagFactsConfirmed: false
                }
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async confirmBagFacts(input) {
        this.assertLuxuryMode();
        if (!this.requireInsert().identificationText) {
            throw new Error("请先完成外包识别与公开尺寸核验");
        }
        if (!input.brand.trim() || !input.bagFamily.trim()) {
            throw new Error("品牌和包型不能为空");
        }
        this.validateBagVariants(input.variants);
        if (!input.variants.some((variant) => variant.id === input.primaryVariantId)) {
            throw new Error("主推 SKU 必须来自已确认尺寸版本");
        }
        return this.store.update({
            stage: "PAUSED",
            message: "包型和公开尺寸已确认，可以提交 NotebookLM 规划",
            error: undefined,
            luxuryInsert: {
                ...this.store.get().luxuryInsert,
                brand: input.brand.trim(),
                bagFamily: input.bagFamily.trim(),
                primaryVariantId: input.primaryVariantId,
                variants: input.variants,
                bagFactsConfirmed: true
            }
        });
    }
    async unlockBagFacts() {
        this.assertLuxuryMode();
        const state = this.store.get();
        const insert = this.requireInsert();
        if (state.running)
            throw new Error("流程运行中，不能返回修改");
        if (!insert.bagFactsConfirmed)
            return state;
        await this.archiveRollbackArtifacts("bag");
        const variants = (insert.variants ?? []).map((variant) => ({
            id: variant.id,
            label: variant.label,
            bagDimensions: variant.bagDimensions,
            publicSourceUrl: variant.publicSourceUrl,
            version: variant.version,
            confidence: variant.confidence
        }));
        return this.store.update({
            stage: "INSERT_WAITING_BAG_CONFIRMATION",
            message: "已返回包型尺寸确认，请修改后重新锁定",
            error: undefined,
            luxuryInsert: {
                ...insert,
                variants,
                bagFactsConfirmed: false,
                notebookInputText: undefined,
                notebookResultText: undefined,
                designFrozen: false,
                claims: undefined,
                promptPackText: undefined,
                promptPackValid: false,
                linerImagesUploaded: false,
                generatedImageNumbers: [],
                outputFiles: [],
                currentImageNumber: undefined
            }
        });
    }
    async planWithNotebook() {
        this.assertLuxuryMode();
        const insert = this.requireInsert();
        if (!insert.bagFactsConfirmed || !insert.variants?.length) {
            throw new Error("请先人工确认包型、版本和公开尺寸");
        }
        await this.store.update({
            running: true,
            pauseRequested: false,
            stage: "INSERT_QUERYING_NOTEBOOK",
            message: "正在向 NotebookLM 内胆尺寸库提交当前任务…",
            error: undefined
        });
        try {
            const input = this.buildNotebookInput(insert);
            const jobFingerprint = `NOTEBOOK_JOB: ${insert.taskId}-V2`;
            await this.store.update({
                luxuryInsert: {
                    ...this.requireInsert(),
                    notebookInputText: input,
                    notebookResultText: undefined
                }
            });
            // NotebookLM shares the dedicated Chrome profile with the selected AI.
            // Launching the AI adapter first guarantees that the CDP endpoint exists.
            await this.ai.launch();
            const result = await this.notebook.sendOnce(input, jobFingerprint);
            await this.store.update({
                luxuryInsert: {
                    ...this.requireInsert(),
                    notebookInputText: input,
                    notebookResultText: result
                }
            });
            if (!result.includes(NOTEBOOK_START) || !result.includes(NOTEBOOK_END)) {
                throw new Error("NotebookLM 回复缺少固定边界标记，未冻结任何设计数据");
            }
            const plannedVariants = parseNotebookInsertData(result, insert.variants);
            await mkdir(INSERT_OUTPUT_DIR, { recursive: true });
            await Promise.all([
                writeFile(path.join(INSERT_OUTPUT_DIR, "03_NOTEBOOKLM_INPUT.md"), `${input}\n`, "utf8"),
                writeFile(path.join(INSERT_OUTPUT_DIR, "04_NOTEBOOKLM_RESULT.md"), `${result}\n`, "utf8")
            ]);
            if (this.store.get().pauseRequested) {
                await this.store.update({
                    running: false,
                    pauseRequested: false,
                    stage: "PAUSED",
                    interruptedStage: "INSERT_QUERYING_NOTEBOOK",
                    message: "NotebookLM 结果已保存，任务已安全暂停",
                    luxuryInsert: {
                        ...this.requireInsert(),
                        notebookInputText: input,
                        notebookResultText: result,
                        variants: plannedVariants
                    }
                });
                return;
            }
            await this.store.update({
                running: false,
                stage: "INSERT_WAITING_DESIGN_FREEZE",
                message: "NotebookLM 内胆方案已自动回填，请核对后点击确认并冻结",
                luxuryInsert: {
                    ...this.requireInsert(),
                    notebookInputText: input,
                    notebookResultText: result,
                    variants: plannedVariants
                }
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async reExtractNotebookResult() {
        this.assertLuxuryMode();
        const insert = this.requireInsert();
        if (!insert.bagFactsConfirmed || !insert.variants?.length) {
            throw new Error("请先人工确认包型、版本和公开尺寸");
        }
        const jobFingerprint = `NOTEBOOK_JOB: ${insert.taskId}-V2`;
        // Step 1: try fingerprint-based recover first
        await this.ai.launch();
        let result = await this.notebook.recover(jobFingerprint);
        // Step 2: if recovered text lacks markers, scan all answers for the richest one
        if (!result || !result.includes(NOTEBOOK_START) || !result.includes(NOTEBOOK_END)) {
            result = await this.notebook.scanForMarkedAnswer(NOTEBOOK_START, NOTEBOOK_END);
        }
        if (!result || !result.includes(NOTEBOOK_START) || !result.includes(NOTEBOOK_END)) {
            throw new Error(
                "NotebookLM 当前会话未找到含标记的完整方案数据。" +
                "请在 NotebookLM 中确认已显示 <<<NOTEBOOK_INSERT_PLAN_START>>> 开头的结果，或手动粘贴内容。"
            );
        }
        const plannedVariants = parseNotebookInsertData(result, insert.variants);
        await mkdir(INSERT_OUTPUT_DIR, { recursive: true });
        await writeFile(path.join(INSERT_OUTPUT_DIR, "04_NOTEBOOKLM_RESULT.md"), `${result}\n`, "utf8");
        return this.store.update({
            stage: "INSERT_WAITING_DESIGN_FREEZE",
            message: "NotebookLM 内胆方案已重新提取并自动回填，请核对后点击确认并冻结",
            luxuryInsert: {
                ...this.requireInsert(),
                notebookInputText: insert.notebookInputText,
                notebookResultText: result,
                variants: plannedVariants
            }
        });
    }
    async importNotebookResultText(text) {
        this.assertLuxuryMode();
        const insert = this.requireInsert();
        if (!insert.bagFactsConfirmed || !insert.variants?.length) {
            throw new Error("请先人工确认包型、版本和公开尺寸");
        }
        if (!text || !text.includes(NOTEBOOK_START) || !text.includes(NOTEBOOK_END)) {
            throw new Error("粘贴的内容缺少 NotebookLM 方案标记（<<<NOTEBOOK_INSERT_PLAN_START>>>）");
        }
        const plannedVariants = parseNotebookInsertData(text, insert.variants);
        await mkdir(INSERT_OUTPUT_DIR, { recursive: true });
        await writeFile(path.join(INSERT_OUTPUT_DIR, "04_NOTEBOOKLM_RESULT.md"), `${text}\n`, "utf8");
        return this.store.update({
            stage: "INSERT_WAITING_DESIGN_FREEZE",
            message: "NotebookLM 方案已导入并自动回填，请核对后点击确认并冻结",
            luxuryInsert: {
                ...this.requireInsert(),
                notebookInputText: insert.notebookInputText,
                notebookResultText: text,
                variants: plannedVariants
            }
        });
    }
    async freezeDesign(input) {
        this.assertLuxuryMode();
        const current = this.requireInsert();
        if (!current.notebookResultText)
            throw new Error("请先完成 NotebookLM 规划");
        this.validateFrozenVariants(input.variants);
        const facts = this.frozenFacts({
            ...current,
            variants: input.variants,
            claims: input.claims
        });
        await mkdir(INSERT_OUTPUT_DIR, { recursive: true });
        await writeFile(path.join(INSERT_OUTPUT_DIR, "05_FROZEN_PRODUCT_FACTS.md"), `${facts}\n`, "utf8");
        return this.store.update({
            stage: "INSERT_WAITING_LINER_IMAGES",
            message: "最终产品事实已冻结，请为每个 SKU 上传对应内胆主图",
            error: undefined,
            luxuryInsert: {
                ...current,
                variants: input.variants,
                claims: input.claims,
                designFrozen: true,
                linerImagesUploaded: false
            }
        });
    }
    async unlockDesign() {
        this.assertLuxuryMode();
        const state = this.store.get();
        const insert = this.requireInsert();
        if (state.running)
            throw new Error("流程运行中，不能返回修改");
        if (!insert.designFrozen)
            return state;
        await this.archiveRollbackArtifacts("design");
        return this.store.update({
            stage: "INSERT_WAITING_DESIGN_FREEZE",
            message: "已解除内胆方案冻结，请修改后重新确认",
            error: undefined,
            luxuryInsert: {
                ...insert,
                designFrozen: false,
                promptPackText: undefined,
                promptPackValid: false,
                generatedImageNumbers: [],
                outputFiles: [],
                currentImageNumber: undefined
            }
        });
    }
    async archiveRollbackArtifacts(scope) {
        const entries = await readdir(INSERT_OUTPUT_DIR, { withFileTypes: true })
            .catch(() => []);
        const names = entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((name) => {
            if (/^Image_0[1-7]\.(png|jpe?g|webp)$/i.test(name))
                return true;
            if (name === "06_IMAGE_PROMPT_PACK.md")
                return true;
            if (name === "05_FROZEN_PRODUCT_FACTS.md")
                return true;
            return scope === "bag" && [
                "03_NOTEBOOKLM_INPUT.md",
                "04_NOTEBOOKLM_RESULT.md"
            ].includes(name);
        });
        if (!names.length)
            return;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const destination = path.join(INSERT_OUTPUT_DIR, "回撤备份", `${stamp}-${scope}`);
        await mkdir(destination, { recursive: true });
        await Promise.all(names.map((name) => rename(path.join(INSERT_OUTPUT_DIR, name), path.join(destination, name))));
    }
    async buildPromptPack() {
        this.assertLuxuryMode();
        const insert = this.requireInsert();
        if (!insert.designFrozen || !insert.variants?.length)
            throw new Error("请先冻结最终内胆方案");
        const linerImages = await scanImages(INSERT_LINER_IMAGES_DIR, {
            preserveDuplicates: true
        });
        const missing = insert.variants.filter((variant) => !variant.linerImageName || !linerImages.some((image) => image.name === variant.linerImageName));
        if (missing.length)
            throw new Error(`以下 SKU 缺少内胆主图：${missing.map((item) => item.label).join("、")}`);
        await this.store.update({
            running: true,
            pauseRequested: false,
            stage: "INSERT_BUILDING_PROMPTS",
            message: "正在上传内胆 SKU 图片并生成 Image 01–07 Prompt Pack…",
            error: undefined
        });
        try {
            if (!this.store.get().chatUrl)
                throw new Error("当前 AI 商品对话不存在");
            await this.ai.openChat(this.store.get().chatUrl);
            if (!insert.linerImagesUploaded) {
                await this.ai.uploadImages(linerImages.map((image) => image.path));
                await this.store.update({
                    luxuryInsert: { ...this.requireInsert(), linerImagesUploaded: true }
                });
            }
            const template = await readPrompt("luxuryInsert");
            const primary = insert.variants.find((variant) => variant.id === insert.primaryVariantId);
            const prompt = template
                .replaceAll("{{FROZEN_FACTS}}", this.frozenFacts(this.requireInsert()))
                .replaceAll("{{CLAIMS}}", this.claimText(this.requireInsert()))
                .replaceAll("{{PRODUCT_NAME}}", `${insert.brand} ${insert.bagFamily} ${primary.label}`);
            const fingerprint = "# Luxury Bag Organizer Image 01–07 Prompt Pack";
            await this.ai.sendPromptOnce(prompt, fingerprint);
            const text = await this.ai.waitForResponseAfterPrompt(fingerprint);
            const validation = validateNumberedPromptPack(text, 7);
            if (!validation.valid) {
                throw new Error(`Image 01–07 Prompt Pack 不完整，缺少：${validation.missing.join(", ")}`);
            }
            await mkdir(INSERT_OUTPUT_DIR, { recursive: true });
            await writeFile(path.join(INSERT_OUTPUT_DIR, "06_IMAGE_PROMPT_PACK.md"), `${text}\n`, "utf8");
            if (this.store.get().pauseRequested) {
                await this.store.update({
                    running: false,
                    pauseRequested: false,
                    stage: "PAUSED",
                    interruptedStage: "INSERT_BUILDING_PROMPTS",
                    message: "7 图 Prompt Pack 已保存，任务已安全暂停",
                    luxuryInsert: {
                        ...this.requireInsert(),
                        promptPackText: text,
                        promptPackValid: true
                    }
                });
                return;
            }
            await this.store.update({
                running: false,
                stage: "PAUSED",
                message: "Image 01–07 Prompt Pack 已校验，可以逐张生图",
                luxuryInsert: {
                    ...this.requireInsert(),
                    promptPackText: text,
                    promptPackValid: true
                }
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async generateImages() {
        this.assertLuxuryMode();
        const insert = this.requireInsert();
        if (!insert.promptPackValid || !insert.promptPackText || !this.store.get().chatUrl) {
            throw new Error("Image 01–07 Prompt Pack 尚未准备完成");
        }
        const generated = new Set(insert.generatedImageNumbers ?? []);
        await mkdir(INSERT_OUTPUT_DIR, { recursive: true });
        await this.store.update({
            running: true,
            pauseRequested: false,
            stage: "INSERT_GENERATING_IMAGES",
            message: "正在恢复对话并逐张生成内胆 Listing 图片…",
            error: undefined
        });
        try {
            await this.ai.openChat(this.store.get().chatUrl);
            const bagImages = await scanImages(INSERT_BAG_IMAGES_DIR, {
                preserveDuplicates: true
            });
            const linerImages = await scanImages(INSERT_LINER_IMAGES_DIR, {
                preserveDuplicates: true
            });
            for (let number = 1; number <= 7; number += 1) {
                if (generated.has(number))
                    continue;
                if (this.store.get().pauseRequested) {
                    await this.store.update({
                        running: false,
                        pauseRequested: false,
                        stage: "PAUSED",
                        interruptedStage: "INSERT_GENERATING_IMAGES",
                        luxuryInsert: {
                            ...this.requireInsert(),
                            currentImageNumber: undefined
                        },
                        message: `任务已安全暂停，已完成 ${generated.size}/7 张图片`
                    });
                    return;
                }
                const outputPath = path.join(INSERT_OUTPUT_DIR, `Image_${String(number).padStart(2, "0")}.png`);
                const interrupted = insert.currentImageNumber === number;
                if (interrupted &&
                    (await this.ai.saveLatestCompletedGeneratedImage(outputPath, generated.size))) {
                    generated.add(number);
                    await this.store.update({
                        luxuryInsert: {
                            ...this.requireInsert(),
                            generatedImageNumbers: [...generated].sort((a, b) => a - b),
                            outputFiles: [...generated].sort((a, b) => a - b).map((item) => `Image_${String(item).padStart(2, "0")}.png`)
                        },
                        message: `Image ${number} 已从页面恢复并保存`
                    });
                    continue;
                }
                if (interrupted &&
                    (await this.ai.hasUserPrompt(`请生成 Image ${number}`))) {
                    await this.ai.waitForGeneratedImageAndDownload(generated.size, outputPath);
                    generated.add(number);
                    await this.store.update({
                        luxuryInsert: {
                            ...this.requireInsert(),
                            generatedImageNumbers: [...generated].sort((a, b) => a - b),
                            outputFiles: [...generated].sort((a, b) => a - b).map((item) => `Image_${String(item).padStart(2, "0")}.png`)
                        },
                        message: `Image ${number} 已从断点恢复并保存`
                    });
                    continue;
                }
                await this.store.update({
                    luxuryInsert: { ...this.requireInsert(), currentImageNumber: number },
                    message: `正在生成内胆 Image ${number}/7`
                });
                await this.ai.enableImageCreation();
                const previous = await this.ai.generatedImageCount();
                const imagePrompt = extractNumberedImagePrompt(insert.promptPackText, number, 7);
                const command = `请生成 Image ${number}。\n\n${imagePrompt}\n\n只生成这一张独立 1:1 正方形电商图片。不要生成其他编号，不要解释。`;
                const referenceImagePaths = insertGenerationReferenceImagePaths(insert, number, bagImages, linerImages);
                await this.ai.uploadImages(referenceImagePaths);
                await this.ai.sendPromptOnce(command, `请生成 Image ${number}`);
                await this.ai.waitForGeneratedImageAndDownload(previous, outputPath);
                generated.add(number);
                await this.store.update({
                    luxuryInsert: {
                        ...this.requireInsert(),
                        generatedImageNumbers: [...generated].sort((a, b) => a - b),
                        outputFiles: [...generated].sort((a, b) => a - b).map((item) => `Image_${String(item).padStart(2, "0")}.png`)
                    }
                });
                if (this.store.get().pauseRequested) {
                    await this.store.update({
                        running: false,
                        pauseRequested: false,
                        stage: "PAUSED",
                        interruptedStage: "INSERT_GENERATING_IMAGES",
                        luxuryInsert: {
                            ...this.requireInsert(),
                            currentImageNumber: undefined
                        },
                        message: `当前图片已保存，任务已安全暂停（${generated.size}/7）`
                    });
                    return;
                }
            }
            await this.store.update({
                running: false,
                stage: "PAUSED",
                message: "7 张图片已完成，可以继续生成内胆 Listing 文案",
                luxuryInsert: { ...this.requireInsert(), currentImageNumber: undefined }
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async generateListingContent() {
        this.assertLuxuryMode();
        const insert = this.requireInsert();
        if ((insert.generatedImageNumbers?.length ?? 0) < 7) {
            throw new Error("请先完成 Image 01–07 逐张生成");
        }
        if (!insert.promptPackText || !this.store.get().chatUrl) {
            throw new Error("内胆 Prompt Pack 或 AI 对话不存在");
        }
        await this.store.update({
            running: true,
            pauseRequested: false,
            stage: "INSERT_GENERATING_LISTING_CONTENT",
            message: "正在生成内胆 Listing 标题、属性词和详情页文案…",
            error: undefined
        });
        try {
            await this.ai.openChat(this.store.get().chatUrl);
            const template = await readPrompt("insertListingContent");
            const prompt = [
                INSERT_LISTING_CONTENT_FINGERPRINT,
                template
                    .replaceAll("{{FROZEN_FACTS}}", this.frozenFacts(insert))
                    .replaceAll("{{CLAIMS}}", this.claimText(insert))
                    .replaceAll("{{PROMPT_PACK}}", insert.promptPackText)
                    .replaceAll("{{SEO_KEYWORD_REPORT}}", insert.seoKeywordReport || "（暂无 Google Ads 关键词报告，请基于已确认事实和常见 AliExpress / Amazon 搜索词生成）")
            ].join("\n\n");
            await this.ai.sendPromptOnce(prompt, INSERT_LISTING_CONTENT_FINGERPRINT);
            const text = await this.ai.waitForResponseAfterPrompt(INSERT_LISTING_CONTENT_FINGERPRINT);
            if (!text.includes(INSERT_LISTING_CONTENT_START) ||
                !text.includes(INSERT_LISTING_CONTENT_END)) {
                throw new Error("内胆 Listing 文案缺少固定边界，流程已暂停且不会自动重发");
            }
            await mkdir(INSERT_OUTPUT_DIR, { recursive: true });
            await writeFile(path.join(INSERT_OUTPUT_DIR, "07_LISTING_CONTENT.md"), `${text}\n`, "utf8");
            if (this.store.get().pauseRequested) {
                await this.store.update({
                    running: false,
                    pauseRequested: false,
                    stage: "PAUSED",
                    interruptedStage: "INSERT_GENERATING_LISTING_CONTENT",
                    message: "内胆 Listing 文案已保存，任务已安全暂停",
                    luxuryInsert: {
                        ...this.requireInsert(),
                        listingContentText: text,
                        listingContentGenerated: true
                    }
                });
                return;
            }
            await this.store.update({
                running: false,
                stage: "PAUSED",
                message: "内胆 Listing 文案已生成，可以写入库存尺寸表或归档",
                luxuryInsert: {
                    ...this.requireInsert(),
                    listingContentText: text,
                    listingContentGenerated: true
                }
            });
        }
        catch (error) {
            await this.fail(error);
        }
    }
    async archiveCompletedInsert() {
        this.assertLuxuryMode();
        const insert = this.requireInsert();
        if ((insert.generatedImageNumbers?.length ?? 0) < 7) {
            throw new Error("请先完成 Image 01–07");
        }
        if (!insert.listingContentGenerated) {
            throw new Error("请先生成内胆 Listing 文案");
        }
        await this.store.update({
            running: true,
            stage: "INSERT_ARCHIVING",
            message: "正在归档内胆开发包…",
            error: undefined
        });
        try {
            const archiveDirectory = await this.archive();
            return await this.store.update({
                running: false,
                stage: "COMPLETED",
                message: "奢侈包内胆设计、Listing 文案与 Image 01–07 已完成并归档",
                luxuryInsert: { ...this.requireInsert(), archiveDirectory }
            });
        }
        catch (error) {
            await this.fail(error);
            return this.store.get();
        }
    }
    async previewStockSheetRows() {
        this.assertLuxuryMode();
        const insert = this.requireInsert();
        if (!insert.designFrozen || !insert.variants?.length) {
            throw new Error("请先冻结最终内胆方案");
        }
        const existing = await this.readStockSheetRecords();
        const existingSkus = new Set(existing.map((record) => record.skuCode));
        const rows = insert.variants.map((variant) => {
            if (!variant.insertDimensions) {
                throw new Error(`${variant.label} 缺少内胆尺寸`);
            }
            const skuCode = variant.inventorySku || variant.id;
            const now = new Date().toISOString();
            return {
                recordId: this.stockRecordId(insert.taskId, variant.id),
                variantId: variant.id,
                skuCode,
                material: variant.material || "毛毡",
                length: variant.insertDimensions.length,
                width: variant.insertDimensions.width,
                height: variant.insertDimensions.height,
                fitRange: variant.fitClearance || "",
                sheetUrl: INSERT_STOCK_SHEET_URL,
                sheetName: INSERT_STOCK_SHEET_NAME,
                status: existingSkus.has(skuCode) ? "skipped_duplicate" : "pending_copy",
                createdAt: now,
                updatedAt: now
            };
        });
        return { rows, tsv: this.stockRowsToTsv(rows) };
    }
    async recordStockSheetRows(rows) {
        this.assertLuxuryMode();
        const existing = await this.readStockSheetRecords();
        const byId = new Map(existing.map((record) => [record.recordId, record]));
        const now = new Date().toISOString();
        for (const row of rows) {
            byId.set(row.recordId, {
                ...row,
                status: row.status === "skipped_duplicate" ? "skipped_duplicate" : "recorded",
                updatedAt: now
            });
        }
        const records = [...byId.values()];
        await this.writeStockSheetRecords(records);
        await this.store.update({
            stage: "PAUSED",
            message: "内胆库存尺寸表写入记录已保存，可复制 TSV 到 Google Sheet",
            luxuryInsert: {
                ...this.requireInsert(),
                stockSheetRecords: records.filter((record) => rows.some((row) => row.recordId === record.recordId))
            }
        });
        return records;
    }
    async getStockSheetWebhookConfig() {
        const config = await this.readSheetsWebhookConfig();
        return {
            configured: Boolean(config?.webhookUrl && config.token),
            webhookUrl: config?.webhookUrl,
            updatedAt: config?.updatedAt
        };
    }
    async saveStockSheetWebhookConfig(config) {
        const webhookUrl = String(config.webhookUrl ?? "").trim();
        const token = String(config.token ?? "").trim();
        if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(webhookUrl)) {
            throw new Error("Webhook URL 必须是 Google Apps Script Web App 地址");
        }
        if (token.length < 8) {
            throw new Error("写入密钥至少 8 位，用于防止误写入");
        }
        const next = {
            webhookUrl,
            token,
            updatedAt: new Date().toISOString()
        };
        await writeFile(GOOGLE_SHEETS_WEBHOOK_CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        return this.getStockSheetWebhookConfig();
    }
    async writeStockSheetRows(rows) {
        this.assertLuxuryMode();
        const config = await this.readSheetsWebhookConfig();
        if (!config?.webhookUrl || !config.token) {
            throw new Error("尚未配置 Google Sheets 自动写入授权，请先保存 Webhook URL 和写入密钥");
        }
        const writableRows = rows.filter((row) => row.status !== "skipped_duplicate");
        if (!writableRows.length) {
            return this.recordStockSheetRows(rows);
        }
        const response = await fetch(config.webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                token: config.token,
                spreadsheetUrl: INSERT_STOCK_SHEET_URL,
                sheetName: INSERT_STOCK_SHEET_NAME,
                rows: writableRows.map((row) => ({
                    recordId: row.recordId,
                    skuCode: row.skuCode,
                    material: row.material,
                    length: row.length,
                    width: row.width,
                    height: row.height,
                    fitRange: row.fitRange
                }))
            })
        });
        const payload = await response.json().catch(() => undefined);
        if (!response.ok || !payload?.ok) {
            throw new Error(payload?.error || `Google Sheets 写入失败：HTTP ${response.status}`);
        }
        const resultBySku = new Map((payload.results ?? []).map((result) => [result.skuCode, result]));
        const now = new Date().toISOString();
        const marked = rows.map((row) => {
            const result = resultBySku.get(row.skuCode);
            if (!result)
                return row;
            return {
                ...row,
                rowNumber: result.rowNumber ?? row.rowNumber,
                status: result.status === "skipped_duplicate"
                    ? "skipped_duplicate"
                    : result.status === "failed"
                        ? "write_failed"
                        : "auto_written",
                updatedAt: now
            };
        });
        const existing = await this.readStockSheetRecords();
        const byId = new Map(existing.map((record) => [record.recordId, record]));
        for (const row of marked)
            byId.set(row.recordId, row);
        const records = [...byId.values()];
        await this.writeStockSheetRecords(records);
        await this.store.update({
            stage: "PAUSED",
            message: "内胆库存尺寸表已自动写入 Google Sheet，并已记录本地写入结果",
            luxuryInsert: {
                ...this.requireInsert(),
                stockSheetRecords: marked
            }
        });
        return marked;
    }
    async resume() {
        const state = this.store.get();
        const insert = this.requireInsert();
        if (state.running)
            throw new Error("当前已有任务正在运行");
        const bagImages = await scanImages(INSERT_BAG_IMAGES_DIR);
        if (!insert.identificationText && bagImages.length)
            return this.identifyBag();
        if (!insert.identificationText) {
            await this.store.update({
                stage: "PAUSED",
                running: false,
                message: "请先上传目标外包图，或从每日市场雷达选择可导入图片的包型",
                error: undefined
            });
            return;
        }
        if (!insert.bagFactsConfirmed) {
            await this.store.update({
                stage: "INSERT_WAITING_BAG_CONFIRMATION",
                running: false,
                message: "请先核对并确认包型、版本与公开尺寸",
                error: undefined
            });
            return;
        }
        if (!insert.notebookResultText)
            return this.planWithNotebook();
        if (!insert.designFrozen) {
            await this.store.update({
                stage: "INSERT_WAITING_DESIGN_FREEZE",
                running: false,
                message: "请先确认并冻结最终内胆方案",
                error: undefined
            });
            return;
        }
        const linerImages = await scanImages(INSERT_LINER_IMAGES_DIR, {
            preserveDuplicates: true
        });
        const linersReady = Boolean(insert.variants?.length) &&
            (insert.variants ?? []).every((variant) => Boolean(variant.linerImageName) &&
                linerImages.some((image) => image.name === variant.linerImageName));
        if (!linersReady) {
            await this.store.update({
                stage: "INSERT_WAITING_LINER_IMAGES",
                running: false,
                message: "请先为每个已确认 SKU 上传对应内胆主图",
                error: undefined
            });
            return;
        }
        if (!insert.promptPackValid)
            return this.buildPromptPack();
        if (state.stage === "INSERT_QUERYING_NOTEBOOK")
            return this.planWithNotebook();
        if (state.stage === "INSERT_BUILDING_PROMPTS")
            return this.buildPromptPack();
        if (state.stage === "INSERT_GENERATING_LISTING_CONTENT") {
            return this.generateListingContent();
        }
        if (state.stage === "INSERT_GENERATING_IMAGES" ||
            (insert.promptPackValid && (insert.generatedImageNumbers?.length ?? 0) < 7))
            return this.generateImages();
        if ((insert.generatedImageNumbers?.length ?? 0) >= 7 && !insert.listingContentGenerated) {
            return this.generateListingContent();
        }
        if (insert.listingContentGenerated) {
            await this.store.update({
                stage: "PAUSED",
                running: false,
                message: "内胆设计与 Listing 文案已完成，请写入库存尺寸表或归档当前产品",
                error: undefined
            });
            return;
        }
        await this.store.update({
            stage: "PAUSED",
            running: false,
            message: "当前内胆任务需要人工确认或补充素材后才能继续",
            error: undefined
        });
    }
    async sync() {
        const insert = this.store.get().luxuryInsert;
        if (!insert) {
            throw new Error("当前没有可同步的内胆任务或市场雷达结果");
        }
        let chatUrl = this.store.get().chatUrl ?? insert.marketRadarChatUrl;
        if (!chatUrl) {
            await this.ai.launch();
            const readiness = await this.ai.checkReady();
            if (!readiness.ready) {
                throw new Error(`请先登录 ${this.providerName(this.store.get().provider)}`);
            }
            const currentUrl = this.ai.currentUrl();
            if (!currentUrl || !this.isConversationUrl(this.store.get().provider, currentUrl)) {
                throw new Error("请在专用 Chrome 中打开刚才的内胆识别对话，再点击同步 AI 状态");
            }
            chatUrl = currentUrl;
            await this.store.update({ chatUrl, browserStarted: true });
        }
        else {
            await this.ai.openChat(chatUrl);
        }
        if (insert.marketRadarText && !insert.marketRadarCandidates?.length) {
            const text = (await this.ai.recoverCompletedResponse(MARKET_RADAR_FINGERPRINT)) ??
                insert.marketRadarText;
            const candidates = await this.saveMarketRadarResult(text);
            return this.store.update({
                stage: "PAUSED",
                error: undefined,
                message: `已从 AI 对话恢复市场雷达候选，共 ${candidates.length} 个`,
                luxuryInsert: {
                    ...this.store.get().luxuryInsert,
                    marketRadarCandidates: candidates
                }
            });
        }
        if (!insert.taskId) {
            return this.store.update({
                stage: "PAUSED",
                error: undefined,
                message: "市场雷达状态已同步，请选择一个候选包型开始开发"
            });
        }
        if (!insert.bagFactsConfirmed && !insert.variants?.length) {
            const text = insert.identificationText ??
                this.store.get().responseText ??
                (await this.ai.recoverCompletedResponse(IDENTIFICATION_FINGERPRINT));
            if (!text)
                throw new Error("当前 AI 对话中未找到可恢复的包型识别回复");
            const identification = parseBagIdentificationData(text);
            return this.store.update({
                responseText: text,
                stage: "INSERT_WAITING_BAG_CONFIRMATION",
                error: undefined,
                message: "已从 AI 对话恢复识别结果并自动回填，请核对后确认",
                luxuryInsert: {
                    ...this.requireInsert(),
                    identificationText: text,
                    publicDimensionSourcesText: text,
                    brand: identification.brand,
                    bagFamily: identification.bagFamily,
                    variants: identification.variants,
                    primaryVariantId: identification.primaryVariantId,
                    bagFactsConfirmed: false
                }
            });
        }
        const current = insert.currentImageNumber;
        const generated = new Set(insert.generatedImageNumbers ?? []);
        if (current && !generated.has(current)) {
            const outputPath = path.join(INSERT_OUTPUT_DIR, `Image_${String(current).padStart(2, "0")}.png`);
            if (await this.ai.saveLatestCompletedGeneratedImage(outputPath, generated.size)) {
                generated.add(current);
            }
        }
        return this.store.update({
            luxuryInsert: {
                ...this.requireInsert(),
                currentImageNumber: undefined,
                generatedImageNumbers: [...generated].sort((a, b) => a - b),
                outputFiles: [...generated].sort((a, b) => a - b).map((item) => `Image_${String(item).padStart(2, "0")}.png`)
            },
            stage: "PAUSED",
            error: undefined,
            message: `内胆图片状态同步完成，后台已保存 ${generated.size}/7 张`
        });
    }
    validateBagVariants(variants) {
        if (!variants.length)
            throw new Error("至少确认一个尺寸 SKU");
        const ids = new Set();
        for (const variant of variants) {
            if (!variant.id.trim() || !variant.label.trim())
                throw new Error("每个 SKU 必须有编号和名称");
            if (ids.has(variant.id))
                throw new Error(`SKU 编号重复：${variant.id}`);
            ids.add(variant.id);
            this.validateDimensions(variant.bagDimensions, `${variant.label} 外包尺寸`);
        }
    }
    validateFrozenVariants(variants) {
        this.validateBagVariants(variants);
        for (const variant of variants) {
            const conflict = insertDimensionConflict(variant);
            if (conflict)
                throw new Error(conflict);
            this.validateDimensions(variant.insertDimensions, `${variant.label} 内胆尺寸`);
            if (variant.weightGrams !== undefined && variant.weightGrams <= 0) {
                throw new Error(`${variant.label} 重量必须大于 0g`);
            }
        }
    }
    validateDimensions(value, label) {
        if (!value || [value.length, value.width, value.height].some((number) => !Number.isFinite(number) || number <= 0)) {
            throw new Error(`${label}必须使用大于 0 的厘米数值`);
        }
    }
    buildNotebookInput(insert) {
        return `# 奢侈包内胆库存匹配与开发任务

TASK_ID: ${insert.taskId}
NOTEBOOK_JOB: ${insert.taskId}-V2
只处理此 TASK_ID，不得引用历史对话中的其他包型尺寸作为本商品事实。

品牌：${insert.brand}
包型家族：${insert.bagFamily}
主推 SKU：${insert.primaryVariantId}

## 已人工确认的外包版本
${insert.variants.map((variant) => `- ${variant.id} | ${variant.label} | 外包 ${this.dimensions(variant.bagDimensions)} | 版本 ${variant.version ?? "未注明"} | 来源 ${variant.publicSourceUrl ?? "图片与人工确认"}`).join("\n")}

请查询本笔记本中的“内胆现货尺寸表”和可信设计资料：
1. 对每个 SKU 判断是否存在可安全复用库存，并给出库存 SKU、间隙和结构风险。
2. 无合适库存时规划新内胆长宽高、材质、颜色、隔层、拉链和边缘结构。
3. 尺寸必须保护原包，不得撑包、顶包、改变开口或折叠逻辑。
4. 不确定项必须明确列出，禁止猜测。

先用以下边界包裹完整的人读报告：
${NOTEBOOK_START}
【完整库存匹配或新开发方案】
${NOTEBOOK_END}

报告之后必须输出以下结构化 JSON 数据块，供网站自动回填。固定标记必须独占一行。
每个已确认 SKU 必须且只能出现一次，id 必须原样使用。
designDecision 只能填写 REUSE_STOCK 或 NEW_DESIGN。
insertDimensions 使用厘米数值；weightGrams 仅在资料明确时填写数值，否则填写 null，禁止猜测。
库存复用时填写 inventorySku；新开发时 inventorySku 填空字符串。

${NOTEBOOK_DATA_START}
\`\`\`json
{
  "variants": [
${insert.variants.map((variant) => `    {
      "id": "${variant.id}",
      "designDecision": "REUSE_STOCK 或 NEW_DESIGN",
      "inventorySku": "",
      "insertDimensions": { "length": 0, "width": 0, "height": 0 },
      "material": "",
      "color": "",
      "structure": "",
      "weightGrams": null,
      "fitClearance": "",
      "designRisks": ""
    }`).join(",\n")}
  ]
}
\`\`\`
${NOTEBOOK_DATA_END}`;
    }
    frozenFacts(insert) {
        return [
            `# Frozen Luxury Insert Facts`,
            `Task ID: ${insert.taskId}`,
            `Brand: ${insert.brand}`,
            `Bag family: ${insert.bagFamily}`,
            `Primary SKU: ${insert.primaryVariantId}`,
            "",
            ...(insert.variants ?? []).map((variant) => `- ${variant.id} | ${variant.label} | Bag ${this.dimensions(variant.bagDimensions)} | Decision ${variant.designDecision ?? "not confirmed"} | Insert ${variant.insertDimensions ? this.dimensions(variant.insertDimensions) : "pending"} | Inventory ${variant.inventorySku || "new development"} | Material ${variant.material || "not confirmed"} | Color ${variant.color || "not confirmed"} | Structure ${variant.structure || "match uploaded liner image"} | Clearance ${variant.fitClearance || "not confirmed"} | Risks ${variant.designRisks || "none recorded"} | Weight ${variant.weightGrams ?? "not confirmed"}g | Liner image ${variant.linerImageName ?? "pending"}`)
        ].join("\n");
    }
    claimText(insert) {
        const claims = insert.claims ?? {};
        return [
            `48h Dispatch: ${claims.dispatch48h ? "allowed" : "not allowed"}`,
            `7-Day Returns: ${claims.returns7Day ? "allowed" : "not allowed"}`,
            `Waterproof: ${claims.waterproof ? "allowed" : "not allowed"}`,
            `High Tear Resistance: ${claims.tearResistant ? "allowed" : "not allowed"}`,
            `Color Fastness: ${claims.colorfast ? "allowed" : "not allowed"}`
        ].join("\n");
    }
    async readStockSheetRecords() {
        try {
            const text = await readFile(INSERT_STOCK_SHEET_RECORDS_FILE, "utf8");
            const parsed = JSON.parse(text);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    async writeStockSheetRecords(records) {
        await writeFile(INSERT_STOCK_SHEET_RECORDS_FILE, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    }
    async readSheetsWebhookConfig() {
        try {
            const text = await readFile(GOOGLE_SHEETS_WEBHOOK_CONFIG_FILE, "utf8");
            const parsed = JSON.parse(text);
            if (typeof parsed?.webhookUrl === "string" &&
                typeof parsed?.token === "string") {
                return parsed;
            }
        }
        catch {
            return undefined;
        }
        return undefined;
    }
    stockRecordId(taskId, variantId) {
        return createHash("sha256")
            .update(`${taskId}:${variantId}`)
            .digest("hex")
            .slice(0, 24);
    }
    stockRowsToTsv(rows) {
        const cell = (value) => String(value ?? "").replace(/\t|\n/g, " ");
        return rows
            .filter((row) => row.status !== "skipped_duplicate")
            .map((row) => [
            row.skuCode,
            "",
            row.material,
            row.length,
            row.width,
            row.height,
            row.fitRange
        ].map(cell).join("\t"))
            .join("\n");
    }
    async archive() {
        const insert = this.requireInsert();
        const name = sanitizeProductName(`${insert.brand} ${insert.bagFamily} 内胆`);
        let destination = path.join(COMPLETED_PRODUCTS_DIR, name);
        let suffix = 2;
        while (await readFile(path.join(destination, "run-state.json")).then(() => true).catch(() => false)) {
            destination = path.join(COMPLETED_PRODUCTS_DIR, `${name} (${suffix})`);
            suffix += 1;
        }
        await mkdir(destination, { recursive: true });
        const archivedOutput = path.join(destination, "output");
        await mkdir(archivedOutput, { recursive: true });
        const outputNames = await readdir(INSERT_OUTPUT_DIR);
        await Promise.all([
            cp(INSERT_BAG_IMAGES_DIR, path.join(destination, "目标外包图"), { recursive: true }),
            cp(INSERT_LINER_IMAGES_DIR, path.join(destination, "内胆图"), { recursive: true }),
            ...outputNames
                .filter((name) => /^Image_0[1-7]\.(png|jpe?g|webp)$/i.test(name))
                .map((name) => cp(path.join(INSERT_OUTPUT_DIR, name), path.join(archivedOutput, name))),
            ...[
                "00_DAILY_MARKET_RADAR.md",
                "00_DAILY_MARKET_RADAR_DATA.json",
                "03_NOTEBOOKLM_INPUT.md",
                "04_NOTEBOOKLM_RESULT.md",
                "05_FROZEN_PRODUCT_FACTS.md",
                "06_IMAGE_PROMPT_PACK.md",
                "07_LISTING_CONTENT.md"
            ].filter((name) => outputNames.includes(name)).map((name) => cp(path.join(INSERT_OUTPUT_DIR, name), path.join(destination, name)))
        ]);
        const state = this.store.get();
        await Promise.all([
            writeFile(path.join(destination, "01_BAG_IDENTIFICATION.md"), `${insert.identificationText ?? ""}\n`, "utf8"),
            writeFile(path.join(destination, "02_PUBLIC_DIMENSION_SOURCES.md"), `${insert.publicDimensionSourcesText ?? ""}\n`, "utf8"),
            writeFile(path.join(destination, "run-state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8")
        ]);
        return destination;
    }
    async fail(error) {
        await this.store.update({
            running: false,
            stage: "PAUSED",
            message: "内胆流程已暂停，修复后可从断点继续",
            error: error instanceof Error ? error.message : String(error)
        });
    }
    requireInsert() {
        const insert = this.store.get().luxuryInsert;
        if (!insert?.taskId)
            throw new Error("当前没有奢侈包内胆任务");
        return insert;
    }
    assertLuxuryMode() {
        if (this.store.get().workflowMode !== "luxury_insert") {
            throw new Error("请先切换到奢侈包内胆设计模式");
        }
    }
    isUsableImageUrl(value) {
        if (!value)
            return false;
        if (/not found|manual sourcing/i.test(value))
            return false;
        try {
            const url = new URL(value);
            return url.protocol === "https:" || url.protocol === "http:";
        }
        catch {
            return false;
        }
    }
    async resolveMarketRadarImageUrl(value) {
        const candidates = await this.resolveMarketRadarImageUrls(value);
        return candidates[0];
    }
    async importMarketRadarCandidateBagImage(candidate) {
        const preferredName = `${candidate.brand}-${candidate.bagFamily}-${candidate.sizeVersion || "front"}`;
        const sourceUrls = [
            candidate.officialFrontImageUrl,
            candidate.officialProductUrl
        ].filter(Boolean);
        const imageCandidates = [];
        const seen = new Set();
        for (const sourceUrl of sourceUrls) {
            for (const imageUrl of await this.resolveMarketRadarImageUrls(sourceUrl)) {
                if (seen.has(imageUrl))
                    continue;
                seen.add(imageUrl);
                imageCandidates.push(imageUrl);
            }
        }
        const rejected = [];
        for (const imageUrl of imageCandidates) {
            const result = await importImageUrlsToDirectory(INSERT_BAG_IMAGES_DIR, [imageUrl], [preferredName]);
            if (result.imported.length)
                return { imported: true };
            if (result.skippedDuplicates.length) {
                return {
                    imported: true,
                    warning: "官网/可信白底正面图已存在，未重复导入"
                };
            }
            rejected.push(...result.rejected);
        }
        const screenshotSource = sourceUrls.find((url) => this.isUsableImageUrl(url));
        if (screenshotSource) {
            try {
                const screenshot = await this.screenshotMarketRadarProductPage(screenshotSource);
                const result = await importImagesToDirectory(INSERT_BAG_IMAGES_DIR, [{ originalname: `${preferredName}.png`, buffer: screenshot }], [preferredName]);
                if (result.imported.length || result.skippedDuplicates.length) {
                    return {
                        imported: true,
                        warning: result.skippedDuplicates.length
                            ? "官网产品页截图已存在，未重复导入"
                            : "未找到可下载白底图，已自动导入官网/可信页面截图作为外包识别参考"
                    };
                }
            }
            catch (error) {
                rejected.push(error instanceof Error ? error.message : String(error));
            }
        }
        return {
            imported: false,
            warning: rejected.length
                ? `官网/可信图片自动导入失败，请人工上传目标外包图：${rejected.slice(0, 2).join("；")}`
                : "该候选没有可直接导入的官网/可信白底正面图，请人工上传目标外包图"
        };
    }
    async importResolvedBagImageFromUrl(rawUrl, preferredName, aggregate) {
        const imageCandidates = await this.resolveMarketRadarImageUrls(rawUrl);
        for (const imageUrl of imageCandidates) {
            const result = await importImageUrlsToDirectory(INSERT_BAG_IMAGES_DIR, [imageUrl], [preferredName]);
            aggregate.imported.push(...result.imported);
            aggregate.skippedDuplicates.push(...result.skippedDuplicates);
            if (result.imported.length || result.skippedDuplicates.length)
                return true;
        }
        if (this.isUsableImageUrl(rawUrl)) {
            try {
                const screenshot = await this.screenshotMarketRadarProductPage(rawUrl);
                const result = await importImagesToDirectory(INSERT_BAG_IMAGES_DIR, [{ originalname: `${preferredName}.png`, buffer: screenshot }], [preferredName]);
                aggregate.imported.push(...result.imported);
                aggregate.skippedDuplicates.push(...result.skippedDuplicates);
                if (result.imported.length || result.skippedDuplicates.length)
                    return true;
            }
            catch {
                return false;
            }
        }
        return false;
    }
    async resolveMarketRadarImageUrls(value) {
        if (!this.isUsableImageUrl(value))
            return [];
        const url = new URL(String(value));
        await assertPublicHost(url.hostname);
        if (this.looksLikeImageUrl(url.toString()))
            return [url.toString()];
        const response = await fetch(url, {
            redirect: "follow",
            headers: {
                accept: "text/html,image/*",
                "user-agent": "Yikuaerjing-MarketRadar/1.0"
            },
            signal: AbortSignal.timeout(15_000)
        });
        if (!response.ok)
            return [];
        const contentType = response.headers.get("content-type") || "";
        if (contentType.startsWith("image/"))
            return [response.url || url.toString()];
        if (!contentType.includes("text/html"))
            return [];
        const html = (await response.text()).slice(0, 750_000);
        const baseUrl = response.url || url.toString();
        const candidates = this.extractPageImageCandidates(html, baseUrl);
        const safeCandidates = [];
        for (const candidate of candidates) {
            try {
                const resolvedUrl = new URL(candidate);
                await assertPublicHost(resolvedUrl.hostname);
                safeCandidates.push(resolvedUrl.toString());
            }
            catch {
                // Ignore invalid or private-network image candidates.
            }
        }
        return [...new Set(safeCandidates)];
    }
    looksLikeImageUrl(value) {
        return /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(value);
    }
    extractPageImageCandidates(html, baseUrl) {
        const candidates = [];
        const push = (value) => {
            const trimmed = (value ?? "").replace(/&amp;/g, "&").trim();
            if (!trimmed || /^data:/i.test(trimmed))
                return;
            try {
                candidates.push(new URL(trimmed, baseUrl).toString());
            }
            catch {
                // Ignore invalid image candidates.
            }
        };
        push(this.extractMetaImage(html));
        for (const match of html.matchAll(/<link[^>]+(?:rel=["'][^"']*(?:image_src|preload)[^"']*["'][^>]+href=["']([^"']+)["']|href=["']([^"']+)["'][^>]+rel=["'][^"']*(?:image_src|preload)[^"']*["'])[^>]*>/gi)) {
            push(match[1] || match[2]);
        }
        for (const match of html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)) {
            push(match[1]);
        }
        for (const match of html.matchAll(/<img[^>]+srcset=["']([^"']+)["'][^>]*>/gi)) {
            for (const item of match[1].split(",")) {
                push(item.trim().split(/\s+/)[0]);
            }
        }
        return [...new Set(candidates)].sort((a, b) => {
            const score = (value) => {
                const lower = value.toLowerCase();
                let total = 0;
                if (this.looksLikeImageUrl(value))
                    total += 10;
                if (/product|pdp|front|main|large|zoom|media|image/.test(lower))
                    total += 5;
                if (/logo|icon|sprite|avatar|placeholder|loader|badge/.test(lower))
                    total -= 20;
                if (/\.svg(?:[?#]|$)/.test(lower))
                    total -= 30;
                return total;
            };
            return score(b) - score(a);
        });
    }
    async screenshotMarketRadarProductPage(rawUrl) {
        const url = new URL(rawUrl);
        if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error("仅支持 http 或 https 产品页截图");
        }
        await assertPublicHost(url.hostname);
        const browser = await chromium.launch({
            executablePath: CHROME_PATH,
            headless: true,
            args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check"]
        });
        try {
            const page = await browser.newPage({
                viewport: { width: 1280, height: 1280 },
                deviceScaleFactor: 1
            });
            await page.goto(url.toString(), {
                waitUntil: "domcontentloaded",
                timeout: 30_000
            });
            await page.waitForTimeout(2_500);
            return await page.screenshot({
                type: "png",
                fullPage: false
            });
        }
        finally {
            await browser.close();
        }
    }
    extractMetaImage(html) {
        const patterns = [
            /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
            /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i
        ];
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match?.[1])
                return match[1].replace(/&amp;/g, "&").trim();
        }
        const jsonLdImage = this.extractJsonLdImage(html);
        if (jsonLdImage)
            return jsonLdImage;
        return undefined;
    }
    extractJsonLdImage(html) {
        const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
        for (const script of scripts) {
            try {
                const data = JSON.parse(script[1].trim());
                const image = this.findImageInJsonLd(data);
                if (image)
                    return image;
            }
            catch {
                // Some commerce pages include malformed JSON-LD. Ignore and keep scanning.
            }
        }
        return undefined;
    }
    findImageInJsonLd(value) {
        if (!value)
            return undefined;
        if (typeof value === "string") {
            return this.isUsableImageUrl(value) ? value : undefined;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                const image = this.findImageInJsonLd(item);
                if (image)
                    return image;
            }
            return undefined;
        }
        if (typeof value !== "object")
            return undefined;
        const record = value;
        if (record.image) {
            const image = this.findImageInJsonLd(record.image);
            if (image)
                return image;
        }
        for (const key of ["@graph", "offers", "mainEntity"]) {
            const image = this.findImageInJsonLd(record[key]);
            if (image)
                return image;
        }
        return undefined;
    }
    marketRadarCandidateSummary(candidate, warning) {
        return [
            "# 市场雷达预填包型",
            "",
            "该内容来自每日市场选款雷达，仅作为开发入口。仍需执行外包识别、联网核对公开尺寸，并由人工确认后才能进入 NotebookLM。",
            "",
            `Task Candidate ID: ${candidate.candidateId}`,
            `Bag Model: ${candidate.bagModel}`,
            `Brand: ${candidate.brand}`,
            `Bag Family: ${candidate.bagFamily}`,
            `Size Version: ${candidate.sizeVersion || "Not specified"}`,
            `Parent Category: ${candidate.parentCategory || "Not specified"}`,
            `Pool Tier: ${candidate.poolTier}`,
            `Evidence Level: ${candidate.evidenceLevel}`,
            `Heat Type: ${candidate.heatType || "Not specified"}`,
            `Native Organization Level: ${candidate.nativeOrganizationLevel}`,
            `Built-in Features: ${candidate.builtInFeatures.join(", ") || "Not specified"}`,
            `Pain Gap: ${candidate.painGap || "Not specified"}`,
            `Insert Value Type: ${candidate.insertValueType.join(", ") || "Not specified"}`,
            `Organizer Potential: ${candidate.organizerPotential}`,
            `Inventory Reuse Potential: ${candidate.inventoryReusePotential}`,
            `Risk Flags: ${candidate.riskFlags.join(", ") || "No Clear Risk"}`,
            `Official / Trusted White Front Image URL: ${candidate.officialFrontImageUrl || "Not found / needs manual sourcing"}`,
            `Official Product URL: ${candidate.officialProductUrl || "Not specified"}`,
            `Listing-Safe Angle: ${candidate.listingSafeAngle || "Not specified"}`,
            `Next Step: ${candidate.nextStep || "Not specified"}`,
            `Source Evidence: ${candidate.sourceEvidence || "Not specified"}`,
            `Why P0: ${candidate.whyP0 || "Not applicable"}`,
            warning ? `Warning: ${warning}` : ""
        ].filter(Boolean).join("\n");
    }
    dimensions(value) {
        return `${value.length} × ${value.width} × ${value.height} cm`;
    }
    taskId() {
        return `INSERT-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
    }
    providerName(provider) {
        return provider === "gemini" ? "Gemini" : "ChatGPT";
    }
    isConversationUrl(provider, url) {
        return provider === "gemini"
            ? /^https:\/\/gemini\.google\.com\/app\/.+/.test(url)
            : /^https:\/\/chatgpt\.com\/c\/.+/.test(url);
    }
}
//# sourceMappingURL=luxury-insert-service.js.map