import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { COMPLETED_PRODUCTS_DIR, PRODUCT_PROFILE_FILE, PRODUCT_PROFILE_LOG_FILE, PRODUCT_PROFILE_SCHEMA_FILE, PRODUCT_ROOT } from "./config.js";
import { extractChineseProductName, sanitizeProductName } from "./product-session.js";
const PROFILE_FILE_NAME = "product-profile.json";
const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats").default;
const VALID_STAGES = new Set([
    "IDLE",
    "VALIDATING_INPUT",
    "READY_FOR_LOGIN",
    "CREATING_CHAT",
    "UPLOADING_IMAGES",
    "SENDING_PROMPT",
    "WAITING_FOR_RESPONSE",
    "SENDING_RESEARCH",
    "WAITING_FOR_RESEARCH",
    "SENDING_PLANNING",
    "WAITING_FOR_PLANNING",
    "VALIDATING_PROMPT_PACK",
    "GENERATING_IMAGES",
    "DOWNLOADING_IMAGE",
    "SENDING_SEO_KEYWORDS",
    "WAITING_FOR_SEO_KEYWORDS",
    "SENDING_LISTING_CONTENT",
    "WAITING_FOR_LISTING_CONTENT",
    "SAVING_LISTING_CONTENT",
    "INSERT_MARKET_RADAR",
    "INSERT_IDENTIFYING_BAG",
    "INSERT_WAITING_BAG_CONFIRMATION",
    "INSERT_QUERYING_NOTEBOOK",
    "INSERT_WAITING_DESIGN_FREEZE",
    "INSERT_WAITING_LINER_IMAGES",
    "INSERT_BUILDING_PROMPTS",
    "INSERT_GENERATING_IMAGES",
    "INSERT_GENERATING_LISTING_CONTENT",
    "INSERT_RECORDING_STOCK_SHEET",
    "INSERT_ARCHIVING",
    "PAUSED",
    "COMPLETED",
    "FAILED"
]);
export class ProductProfileService {
    validateSchema;
    validationErrors;
    warning;
    queue = Promise.resolve();
    productRoot;
    completedProductsDir;
    profileFile;
    schemaFile;
    logFile;
    constructor(options = {}) {
        this.productRoot = options.productRoot ?? PRODUCT_ROOT;
        this.completedProductsDir =
            options.completedProductsDir ?? COMPLETED_PRODUCTS_DIR;
        this.profileFile = options.profileFile ?? PRODUCT_PROFILE_FILE;
        this.schemaFile = options.schemaFile ?? PRODUCT_PROFILE_SCHEMA_FILE;
        this.logFile = options.logFile ?? PRODUCT_PROFILE_LOG_FILE;
    }
    async initialize() {
        const schema = JSON.parse(await readFile(this.schemaFile, "utf8"));
        const ajv = new Ajv2020({ allErrors: true, strict: true });
        addFormats(ajv);
        const validator = ajv.compile(schema);
        this.validateSchema = (value) => {
            const valid = validator(value);
            this.validationErrors = validator.errors;
            return valid;
        };
    }
    getWarning() {
        return this.warning;
    }
    async reportWarning(context, error) {
        await this.recordWarning(context, error);
    }
    async syncFromState(state) {
        this.queue = this.queue
            .then(() => this.syncFromStateNow(state))
            .catch((error) => this.recordWarning("同步商品档案失败", error));
        await this.queue;
    }
    async getCurrent() {
        return this.readProfile(this.profileFile);
    }
    async updateCurrent(update) {
        const result = await this.readProfile(this.profileFile);
        if (result.status !== "normal" || !result.profile) {
            throw new Error(result.error ?? "当前商品尚未建立档案");
        }
        const profile = result.profile;
        if (update.displayName !== undefined) {
            profile.identity.displayName = sanitizeProductName(update.displayName);
        }
        if (update.notes !== undefined) {
            profile.notes = String(update.notes).slice(0, 10_000);
        }
        if (update.manualOverride !== undefined) {
            const value = update.manualOverride?.trim();
            profile.nextAction.manualOverride = value
                ? {
                    value: value.slice(0, 500),
                    updatedAt: new Date().toISOString(),
                    source: "user"
                }
                : undefined;
        }
        profile.nextAction.effective =
            profile.nextAction.manualOverride?.value ?? profile.nextAction.suggested;
        profile.lifecycle.updatedAt = new Date().toISOString();
        await this.writeProfile(this.profileFile, profile);
        this.warning = undefined;
        return profile;
    }
    async resetManualOverride() {
        return this.updateCurrent({ manualOverride: null });
    }
    async attachQueueSource(source, notes) {
        const result = await this.readProfile(this.profileFile);
        if (result.status !== "normal" || !result.profile)
            return undefined;
        const profile = result.profile;
        profile.queueSource = source;
        if (notes?.trim() && !profile.notes.trim()) {
            profile.notes = notes.trim().slice(0, 10_000);
        }
        profile.lifecycle.updatedAt = new Date().toISOString();
        await this.writeProfile(this.profileFile, profile);
        return profile;
    }
    async archiveCurrent(destination) {
        const result = await this.readProfile(this.profileFile);
        if (result.status !== "normal" || !result.profile)
            return;
        const profile = result.profile;
        const now = new Date().toISOString();
        profile.lifecycle.status = "archived";
        profile.lifecycle.currentStage = "COMPLETED";
        profile.lifecycle.archivedAt = now;
        profile.lifecycle.updatedAt = now;
        profile.archive = {
            archived: true,
            directoryName: path.basename(destination)
        };
        profile.artifacts = await this.scanArtifacts(destination);
        profile.nextAction.suggested = "根据运营计划发布商品或继续维护";
        profile.nextAction.effective =
            profile.nextAction.manualOverride?.value ?? profile.nextAction.suggested;
        await this.writeProfile(path.join(destination, PROFILE_FILE_NAME), profile);
        await rm(this.profileFile, { force: true });
        this.warning = undefined;
    }
    async listLibrary() {
        await mkdir(this.completedProductsDir, { recursive: true });
        const entries = await readdir(this.completedProductsDir, {
            withFileTypes: true
        });
        const products = await Promise.all(entries
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => {
            const profilePath = path.join(this.completedProductsDir, entry.name, PROFILE_FILE_NAME);
            const result = await this.readProfile(profilePath);
            if (result.status === "missing") {
                return {
                    directoryName: entry.name,
                    status: "pending",
                    label: "待建档"
                };
            }
            if (result.status === "invalid" || !result.profile) {
                return {
                    directoryName: entry.name,
                    status: "invalid",
                    label: "档案异常",
                    error: result.error
                };
            }
            return {
                directoryName: entry.name,
                status: "normal",
                label: "正常",
                productId: result.profile.productId,
                displayName: result.profile.identity.displayName,
                workflowMode: result.profile.identity.workflowMode,
                lifecycleStatus: result.profile.lifecycle.status,
                currentStage: result.profile.lifecycle.currentStage,
                createdAt: result.profile.lifecycle.createdAt,
                updatedAt: result.profile.lifecycle.updatedAt,
                notes: result.profile.notes,
                artifactCount: result.profile.artifacts.length,
                artifactTypes: [...new Set(result.profile.artifacts.map((artifact) => artifact.type))],
                thumbnailUrl: this.thumbnailArtifact(result.profile)
                    ? `/api/product-profiles/${encodeURIComponent(result.profile.productId)}/thumbnail`
                    : undefined
            };
        }));
        return products.sort((a, b) => a.directoryName.localeCompare(b.directoryName, "zh-CN"));
    }
    async getArchived(productId) {
        const library = await this.listLibrary();
        const entry = library.find((candidate) => candidate.status === "normal" && candidate.productId === productId);
        if (!entry)
            throw new Error("未找到对应商品档案");
        const result = await this.readProfile(path.join(this.completedProductsDir, entry.directoryName, PROFILE_FILE_NAME));
        if (result.status !== "normal" || !result.profile) {
            throw new Error(result.error ?? "商品档案不可读取");
        }
        return result.profile;
    }
    async getArchivedThumbnail(productId) {
        const { root, profile } = await this.getArchivedRootByProductId(productId);
        const artifact = this.thumbnailArtifact(profile);
        if (!artifact)
            return undefined;
        const absolute = path.resolve(root, artifact.path);
        if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
            throw new Error("缩略图路径越界");
        }
        return absolute;
    }
    async deleteArchived(productId) {
        const { root, profile } = await this.getArchivedRootByProductId(productId);
        await rm(root, { recursive: true, force: true });
        return {
            productId,
            directoryName: profile.archive?.directoryName ?? path.basename(root)
        };
    }
    async previewLegacy(directoryName) {
        const root = this.resolveArchiveDirectory(directoryName);
        const profileResult = await this.readProfile(path.join(root, PROFILE_FILE_NAME));
        if (profileResult.status !== "missing") {
            throw new Error(profileResult.status === "invalid"
                ? "该商品已有异常档案，请先人工处理，系统不会覆盖"
                : "该商品已经建档");
        }
        const state = await this.readArchivedState(root);
        return {
            directoryName,
            displayName: sanitizeProductName(state ? extractChineseProductName(state) : directoryName),
            workflowMode: state?.workflowMode ?? this.inferWorkflowMode(root),
            artifacts: await this.scanArtifacts(root)
        };
    }
    async createLegacy(directoryName) {
        const preview = await this.previewLegacy(directoryName);
        const root = this.resolveArchiveDirectory(directoryName);
        const state = await this.readArchivedState(root);
        const now = new Date().toISOString();
        const profile = {
            schemaVersion: "1.0",
            productId: randomUUID(),
            identity: {
                displayName: preview.displayName,
                workflowMode: preview.workflowMode,
                standardWorkflowGoal: preview.workflowMode === "standard_listing"
                    ? state?.standardWorkflowGoal ?? "full_listing"
                    : undefined,
                brand: state?.luxuryInsert?.brand,
                bagFamily: state?.luxuryInsert?.bagFamily
            },
            lifecycle: {
                status: "archived",
                currentStage: this.safeStage(state?.stage ?? "COMPLETED"),
                createdAt: state?.startedAt ?? state?.updatedAt ?? now,
                updatedAt: now,
                completedAt: state?.updatedAt ?? now,
                archivedAt: now
            },
            nextAction: {
                suggested: "检查历史交付结果并制定下一步运营计划",
                effective: "检查历史交付结果并制定下一步运营计划"
            },
            notes: "",
            artifacts: preview.artifacts,
            archive: {
                archived: true,
                directoryName
            }
        };
        await this.writeProfile(path.join(root, PROFILE_FILE_NAME), profile);
        return profile;
    }
    async createLightweightArchived(input) {
        const now = new Date().toISOString();
        const displayName = sanitizeProductName(input.displayName);
        if (!displayName)
            throw new Error("商品名称不能为空");
        const sourceTag = this.sourceTag(input.sourceTag);
        const notes = this.notesWithSource(input.notes, sourceTag);
        const directoryName = await this.uniqueArchiveDirectoryName(displayName);
        const profile = {
            schemaVersion: "1.0",
            productId: randomUUID(),
            identity: {
                displayName,
                workflowMode: input.workflowMode ?? "standard_listing",
                standardWorkflowGoal: (input.workflowMode ?? "standard_listing") === "standard_listing"
                    ? "full_listing"
                    : undefined,
                category: this.optionalText(input.category, 120)
            },
            lifecycle: {
                status: input.lifecycleStatus ?? "active",
                currentStage: input.currentStage ?? "IDLE",
                createdAt: now,
                updatedAt: now
            },
            nextAction: {
                suggested: this.optionalText(input.nextAction, 500) || "上传产品素材，开始 AI 识别",
                effective: this.optionalText(input.nextAction, 500) || "上传产品素材，开始 AI 识别"
            },
            notes,
            artifacts: [],
            archive: {
                archived: input.archive ?? true,
                directoryName
            }
        };
        await this.writeProfile(path.join(this.completedProductsDir, directoryName, PROFILE_FILE_NAME), profile);
        return profile;
    }
    async syncFromStateNow(state) {
        const shouldExist = (state.workflowMode === "standard_listing" &&
            state.completedPhase === "MVP1" &&
            Boolean(state.responseText)) ||
            (state.workflowMode === "luxury_insert" &&
                Boolean(state.luxuryInsert?.identificationText));
        const existing = await this.readProfile(this.profileFile);
        if (existing.status === "invalid") {
            await this.recordWarning("当前 product-profile.json 异常，已停止自动更新且不会覆盖", existing.error ?? "Schema 校验失败");
            return;
        }
        const isEmptyResetState = state.stage === "IDLE" &&
            !state.chatUrl &&
            !state.completedPhase &&
            !state.luxuryInsert?.taskId;
        if ((!shouldExist && existing.status === "missing") || isEmptyResetState) {
            return;
        }
        const now = new Date().toISOString();
        const belongsToNewTask = Boolean(state.startedAt) &&
            Boolean(existing.profile) &&
            state.startedAt !== existing.profile.lifecycle.taskStartedAt;
        const profile = !existing.profile ||
            (existing.profile.lifecycle.status === "completed" &&
                belongsToNewTask)
            ? this.createFromState(state, now)
            : existing.profile;
        profile.identity.displayName =
            profile.identity.displayName === "未命名产品"
                ? this.displayNameFromState(state)
                : profile.identity.displayName;
        profile.identity.workflowMode = state.workflowMode;
        profile.identity.standardWorkflowGoal =
            state.workflowMode === "standard_listing"
                ? state.standardWorkflowGoal
                : undefined;
        profile.identity.brand = state.luxuryInsert?.brand ?? profile.identity.brand;
        profile.identity.bagFamily =
            state.luxuryInsert?.bagFamily ?? profile.identity.bagFamily;
        profile.identity.category =
            this.extractField(state.responseText, "Recommended Product Category") ??
                profile.identity.category;
        profile.objectiveInfo = state.objectiveInfo ?? profile.objectiveInfo ?? "";
        profile.lifecycle.currentStage = this.safeStage(state.stage);
        profile.lifecycle.status = this.lifecycleStatus(state);
        profile.lifecycle.updatedAt = now;
        if (state.stage === "COMPLETED") {
            profile.lifecycle.completedAt ??= now;
        }
        profile.nextAction.suggested = this.suggestNextAction(state);
        profile.nextAction.effective =
            profile.nextAction.manualOverride?.value ?? profile.nextAction.suggested;
        profile.artifacts = await this.scanArtifacts(this.productRoot);
        await this.writeProfile(this.profileFile, profile);
        this.warning = undefined;
        const archiveDirectory = state.luxuryInsert?.archiveDirectory;
        if (state.workflowMode === "luxury_insert" &&
            archiveDirectory &&
            state.stage === "COMPLETED") {
            await this.archiveCurrent(archiveDirectory);
        }
    }
    createFromState(state, now) {
        const suggested = this.suggestNextAction(state);
        return {
            schemaVersion: "1.0",
            productId: randomUUID(),
            identity: {
                displayName: this.displayNameFromState(state),
                workflowMode: state.workflowMode,
                standardWorkflowGoal: state.workflowMode === "standard_listing"
                    ? state.standardWorkflowGoal
                    : undefined,
                brand: state.luxuryInsert?.brand,
                bagFamily: state.luxuryInsert?.bagFamily,
                category: this.extractField(state.responseText, "Recommended Product Category")
            },
            lifecycle: {
                status: this.lifecycleStatus(state),
                currentStage: this.safeStage(state.stage),
                createdAt: now,
                updatedAt: now,
                taskStartedAt: state.startedAt ?? now
            },
            nextAction: {
                suggested,
                effective: suggested
            },
            notes: "",
            objectiveInfo: state.objectiveInfo || "",
            artifacts: [],
            archive: { archived: false }
        };
    }
    displayNameFromState(state) {
        if (state.workflowMode === "luxury_insert") {
            const insert = state.luxuryInsert;
            return sanitizeProductName(`${insert?.brand ?? ""} ${insert?.bagFamily ?? ""} 内胆`);
        }
        return extractChineseProductName(state);
    }
    lifecycleStatus(state) {
        if (state.stage === "COMPLETED")
            return "completed";
        if (state.stage === "FAILED")
            return "failed";
        if (state.stage === "PAUSED" || state.error)
            return "paused";
        return "active";
    }
    suggestNextAction(state) {
        if (state.workflowMode === "luxury_insert") {
            const insert = state.luxuryInsert;
            const identificationText = insert?.identificationText ?? "";
            const hasRealIdentification = Boolean(identificationText) &&
                !/^#\s*市场雷达预填包型/m.test(identificationText);
            if (!hasRealIdentification)
                return "上传目标外包图并完成目标外包识别";
            if (!insert?.bagFactsConfirmed)
                return "确认包型、版本与公开尺寸";
            if (!insert.notebookResultText)
                return "提交 NotebookLM 库存匹配与内胆规划";
            if (!insert.designFrozen)
                return "确认并冻结最终内胆方案";
            if (!insert.linerImagesUploaded)
                return "为每个 SKU 上传对应内胆图片";
            if (!insert.promptPackValid)
                return "生成并校验 Image 01–07 Prompt Pack";
            if ((insert.generatedImageNumbers?.length ?? 0) < 7) {
                return "继续逐张生成内胆 Listing 图片";
            }
            if (!insert.listingContentGenerated) {
                return "生成内胆 Listing 文案";
            }
            return insert.archiveDirectory
                ? "开始下一个内胆商品"
                : "归档内胆开发包";
        }
        if (!state.completedPhase)
            return "上传产品图片并开始产品识别";
        if (state.completedPhase === "MVP1") {
            if (!state.researchCompleted)
                return "执行联网市场调研与 VOC";
            return state.standardWorkflowGoal === "seo_content_only"
                ? "生成 SEO 关键词与商品文案"
                : "生成视觉规划与 Image 01–10 Prompt Pack";
        }
        if (state.completedPhase === "MVP3")
            return "逐张生成 Image 01–10";
        if (state.completedPhase === "MVP4")
            return "生成 SEO 关键词与商品文案";
        return "归档当前商品并开始下一个商品";
    }
    safeStage(value) {
        if (!VALID_STAGES.has(value)) {
            throw new Error(`非法商品档案阶段：${value}`);
        }
        return value;
    }
    async scanArtifacts(root) {
        const rootPath = path.resolve(root);
        const artifacts = [];
        const walk = async (directory) => {
            const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
            for (const entry of entries) {
                if (entry.name === PROFILE_FILE_NAME || entry.name.startsWith(`.${PROFILE_FILE_NAME}.`)) {
                    continue;
                }
                const absolute = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    await walk(absolute);
                    continue;
                }
                if (!entry.isFile())
                    continue;
                const relative = path.relative(rootPath, absolute).split(path.sep).join("/");
                this.assertRelativeArtifactPath(relative);
                const info = await stat(absolute);
                artifacts.push({
                    path: relative,
                    type: this.artifactType(relative),
                    size: info.size,
                    updatedAt: info.mtime.toISOString()
                });
            }
        };
        await walk(rootPath);
        return artifacts.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
    }
    thumbnailArtifact(profile) {
        const imageArtifacts = profile.artifacts.filter((artifact) => /\.(png|jpe?g|webp)$/i.test(artifact.path));
        return (imageArtifacts.find((artifact) => artifact.type === "source_image" &&
            /(?:^|\/)(?:产品图|目标外包图|内胆图)\//i.test(artifact.path)) ??
            imageArtifacts.find((artifact) => artifact.type === "source_image") ??
            imageArtifacts.find((artifact) => artifact.type === "generated_image") ??
            imageArtifacts[0]);
    }
    artifactType(relativePath) {
        const name = path.posix.basename(relativePath);
        if (/run-state\.json$/i.test(name))
            return "state";
        if (/\.(png|jpe?g|webp)$/i.test(name)) {
            return /(?:^|\/)(?:output|内胆output)\//i.test(relativePath)
                ? "generated_image"
                : "source_image";
        }
        if (/SEO_KEYWORDS/i.test(name))
            return "seo";
        if (/LISTING_CONTENT/i.test(name))
            return "listing_content";
        if (/PROMPT/i.test(name))
            return "prompt";
        if (/NOTEBOOKLM/i.test(name))
            return "notebook";
        if (/(IDENTIFICATION|DIMENSION|FACTS|REPORT)/i.test(name)) {
            return "fact_report";
        }
        return "other";
    }
    assertRelativeArtifactPath(value) {
        if (!value ||
            path.isAbsolute(value) ||
            /^[A-Za-z]:/.test(value) ||
            value.split(/[\\/]+/).includes("..")) {
            throw new Error(`非法档案文件路径：${value}`);
        }
    }
    async readProfile(filePath) {
        let text;
        try {
            text = await readFile(filePath, "utf8");
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return { status: "missing" };
            }
            return { status: "invalid", error: String(error) };
        }
        try {
            const value = JSON.parse(text);
            this.validate(value);
            return { status: "normal", profile: value };
        }
        catch (error) {
            return {
                status: "invalid",
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    validate(profile) {
        if (!this.validateSchema)
            throw new Error("商品档案 Schema 尚未初始化");
        if (!this.validateSchema(profile)) {
            const details = (this.validationErrors ?? [])
                .map((error) => `${error.instancePath || "/"} ${error.message}`)
                .join("; ");
            throw new Error(`Schema 校验失败：${details}`);
        }
        for (const artifact of profile.artifacts) {
            this.assertRelativeArtifactPath(artifact.path);
        }
        this.safeStage(profile.lifecycle.currentStage);
    }
    async writeProfile(filePath, profile) {
        this.validate(profile);
        await mkdir(path.dirname(filePath), { recursive: true });
        const temporary = path.join(path.dirname(filePath), `.${PROFILE_FILE_NAME}.${randomUUID()}.tmp`);
        await import("node:fs/promises").then(({ writeFile }) => writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, "utf8"));
        await rename(temporary, filePath);
    }
    async recordWarning(context, error) {
        const message = `${context}：${error instanceof Error ? error.message : String(error)}`;
        this.warning = message;
        console.warn(message);
        await appendFile(this.logFile, `[${new Date().toISOString()}] ${message}\n`, "utf8").catch(() => undefined);
    }
    resolveArchiveDirectory(directoryName) {
        if (!directoryName ||
            directoryName !== path.basename(directoryName) ||
            directoryName === "." ||
            directoryName === "..") {
            throw new Error("无效归档商品目录");
        }
        const resolved = path.resolve(this.completedProductsDir, directoryName);
        if (path.dirname(resolved) !== path.resolve(this.completedProductsDir)) {
            throw new Error("归档目录路径越界");
        }
        return resolved;
    }
    async getArchivedRootByProductId(productId) {
        await mkdir(this.completedProductsDir, { recursive: true });
        const entries = await readdir(this.completedProductsDir, {
            withFileTypes: true
        });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const root = this.resolveArchiveDirectory(entry.name);
            const result = await this.readProfile(path.join(root, PROFILE_FILE_NAME));
            if (result.status === "normal" && result.profile?.productId === productId) {
                return { root, profile: result.profile };
            }
        }
        throw new Error("未找到对应商品档案");
    }
    async readArchivedState(root) {
        try {
            return JSON.parse(await readFile(path.join(root, "run-state.json"), "utf8"));
        }
        catch {
            return undefined;
        }
    }
    inferWorkflowMode(root) {
        return path.basename(root).includes("内胆")
            ? "luxury_insert"
            : "standard_listing";
    }
    extractField(source, field) {
        if (!source)
            return undefined;
        const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = source.match(new RegExp(`${escaped}\\s*[:：]\\s*([^\\n|]+)`, "i"));
        return match?.[1]?.trim().slice(0, 120);
    }
    sourceTag(value) {
        const text = String(value ?? "").trim();
        if (!/^[a-z][a-z0-9_:-]*$/i.test(text)) {
            throw new Error("商品来源标记不合法");
        }
        return text.slice(0, 80);
    }
    notesWithSource(notes, sourceTag) {
        const marker = `[source: ${sourceTag}]`;
        const text = String(notes ?? "").trim();
        return `${marker}${text ? `\n${text}` : ""}`.slice(0, 10_000);
    }
    optionalText(value, maxLength) {
        const text = String(value ?? "").trim();
        return text ? text.slice(0, maxLength) : undefined;
    }
    async uniqueArchiveDirectoryName(displayName) {
        await mkdir(this.completedProductsDir, { recursive: true });
        const base = sanitizeProductName(displayName).replace(/[/:\\]/g, "-").slice(0, 80) || "未命名商品";
        for (let index = 0; index < 100; index += 1) {
            const suffix = index === 0 ? "" : `-${index + 1}`;
            const directoryName = `${base}${suffix}`;
            try {
                await stat(path.join(this.completedProductsDir, directoryName));
            }
            catch (error) {
                if (error.code === "ENOENT")
                    return directoryName;
                throw error;
            }
        }
        return `${base}-${randomUUID().slice(0, 8)}`;
    }
}
//# sourceMappingURL=product-profile-service.js.map