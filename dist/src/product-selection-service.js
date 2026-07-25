import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { jsonrepair } from "jsonrepair";
import { SELECTION_DIR, SELECTION_CANDIDATES_FILE } from "./config.js";
import { readPrompt } from "./prompt-files.js";
import { assertPublicHost } from "./image-files.js";
const SELECTION_FINGERPRINT = "# 选品研究 Bob v0.1";
const BOB_RESULT_START = "<BOB_RESULT_START>";
const BOB_RESULT_END = "<BOB_RESULT_END>";
const ALLOWED_DECISIONS = [
    "approved_for_development_pool",
    "observe_pool",
    "rejected",
    "manual_review",
    "blocked_by_risk"
];
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
            throw new Error(`${label}不是有效 JSON，无法自动解析`);
        }
    }
}
export class SelectionService {
    store;
    adapters;
    constructor(store, adapters) {
        this.store = store;
        this.adapters = adapters;
    }
    get ai() {
        return this.adapters[this.store.get().provider];
    }
    providerName(provider) {
        return provider === "gemini" ? "Gemini" : "ChatGPT";
    }
    /* ── 占位符替换：将 Bob 表单输入填入 <<<VAR>>>，未填字段按第三部分默认值处理 ── */
    fillPrompt(prompt, input) {
        const depth = String(input.researchDepth || "standard_research");
        const defaultCount = depth === "quick_screening" ? 5 : depth === "deep_research" ? 15 : 10;
        const subs = {
            RUN_ID: String(input.runId || ""),
            TASK_TYPE: String(input.taskType || ""),
            RESEARCH_DEPTH: depth,
            CANDIDATE_TARGET_COUNT: String(input.candidateTargetCount || defaultCount),
            MARKET_SCOPE: String(input.marketScope || "美国（默认）"),
            PLATFORM_SCOPE: "AliExpress（同时使用 Amazon、Etsy、Walmart 及其它公开渠道作为市场参照，默认）",
            CATEGORY_SCOPE: String(input.categoryScope || ""),
            TARGET_CUSTOMER_SCOPE: "未知，由 Bob 通过研究推断并标记为 inferred",
            PRODUCT_INPUTS: "无",
            TARGET_SELLING_PRICE_RANGE: "未提供，按待确认处理（Bob 不得猜测）",
            MAX_PURCHASE_COST: "未提供，按待确认处理（Bob 不得猜测）",
            TARGET_MARGIN_REQUIREMENT: "未提供，按待确认处理（Bob 不得猜测）",
            READY_STOCK_PREFERRED: "未提供（默认优先现货成品）",
            CUSTOMIZATION_ALLOWED: "未提供（默认优先现货成品，不开模）",
            STRUCTURAL_MODIFICATION_ALLOWED: "未提供（默认优先现货成品，不开模）",
            MOLD_OPENING_ALLOWED: "未提供（默认不开模）",
            MAX_ACCEPTABLE_MOQ: "未提供，按待确认处理",
            TARGET_DEVELOPMENT_LEAD_TIME: "未提供，按待确认处理",
            OTHER_BUSINESS_CONSTRAINTS: "无",
            LOGISTICS_CONSTRAINTS: "未提供，使用默认物流约束（三边和≤87cm、计费重量≤2kg、优先轻小件、优先不带液体/粉末/强磁/危险品）",
            AUTHORIZED_CONTEXT_REFS: "无（仅使用本次联网搜索与用户明确提供的输入；不得自动遍历历史聊天记录/文件/候选）"
        };
        let filled = prompt.replace(/<<<\s*([A-Z_]+)\s*>>>/g, (match, key) => (key in subs ? subs[key] : match));
        /* 兜底：清理任何残留占位符，避免把 <<<...>>> 原样发给 Bob */
        filled = filled.replace(/<<<\s*[A-Z_]+\s*>>>/g, "（未提供，按 Bob 默认值处理）");
        return filled;
    }
    async runSelection(input) {
        const state0 = this.store.get();
        if (state0.selection.running)
            throw new Error("当前标品选品正在运行");
        /* 软冲突守卫：标品选品与内胆/上品共享同一 AI 浏览器会话，避免同时驱动 */
        if (state0.running)
            throw new Error("当前有其它流程正在使用 AI 会话，请稍后再运行标品选品");
        /* 注意：运行不再自动从磁盘恢复。磁盘恢复是显式动作（"从磁盘恢复"按钮），
           否则重置后磁盘文件仍在，再次运行会永远返回旧结果，Bob 再也不会被触发。 */
        const runId = input?.runId || randomUUID();
        const safeInput = { ...input, runId };
        await this.store.update({
            selection: {
                ...this.store.get().selection,
                running: true,
                stage: "SELECTION_RUNNING",
                input: safeInput,
                error: undefined,
                message: "正在运行 Bob 选品研究，联网搜索候选机会…",
                updatedAt: new Date().toISOString(),
                candidates: [],
                text: "",
                chatUrl: null,
                decided: {}
            }
        });
        try {
            const readiness = await this.ai.checkReady();
            if (!readiness.ready)
                throw new Error(`${this.providerName(state0.provider)} 尚未登录`);
            await this.ai.createBlankChat();
            try {
                await this.ai.enableWebSearch();
            }
            catch (toolError) {
                /* 部分 ChatGPT 账号/新 UI 自动启用网页搜索，或工具菜单文案不匹配；
                   降级为警告后继续发送 prompt，避免阻断整个选品研究。 */
                console.warn("[SelectionService] enableWebSearch failed (continuing):", toolError instanceof Error ? toolError.message : String(toolError));
            }
            const prompt = await readPrompt("productSelection");
            const filled = this.fillPrompt(prompt, safeInput);
            await this.ai.sendPromptOnce(filled, SELECTION_FINGERPRINT);
            const text = await this.waitForSelectionResponse();
            const parsed = this.parseSelectionResult(text);
            await this.saveSelectionResult(text, parsed);
            await this.store.update({
                selection: {
                    ...this.store.get().selection,
                    running: false,
                    stage: "DONE",
                    text,
                    candidates: parsed.candidates,
                    evidenceRefs: parsed.evidence_refs || [],
                    chatUrl: this.ai.currentUrl(),
                    updatedAt: new Date().toISOString(),
                    message: "选品研究完成，候选已呈现，可逐条采纳进入开发池"
                }
            });
        }
        catch (error) {
            /* 自行吞掉异常并写 selection 命名空间错误，避免污染全局 running/stage */
            await this.fail(error);
        }
    }
    waitForSelectionResponse() {
        return this.waitForSelectionResponseWithFingerprint(SELECTION_FINGERPRINT);
    }
    async waitForSelectionResponseWithFingerprint(fingerprint) {
        let text = await this.ai.waitForResponseAfterPrompt(fingerprint);
        if (text.includes(BOB_RESULT_START) && text.includes(BOB_RESULT_END)) {
            return text;
        }
        const deadline = Date.now() + 10 * 60_000;
        let lastText = text;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 5_000));
            const recovered = await this.ai.recoverCompletedResponse(fingerprint);
            if (recovered) {
                lastText = recovered;
                if (recovered.includes(BOB_RESULT_START) && recovered.includes(BOB_RESULT_END)) {
                    return recovered;
                }
            }
        }
        return lastText;
    }
    parseSelectionResult(text) {
        const start = text.indexOf(BOB_RESULT_START);
        const end = text.indexOf(BOB_RESULT_END, start + BOB_RESULT_START.length);
        if (start === -1 || end === -1) {
            throw new Error("选品研究回复缺少 <BOB_RESULT_START/END> 结构化结果，无法解析");
        }
        const raw = text.slice(start + BOB_RESULT_START.length, end);
        const parsed = parseAiJson(raw, "选品研究结构化结果");
        if (!parsed || typeof parsed !== "object") {
            throw new Error("选品研究结构化结果格式无效");
        }
        const rawCandidates = parsed.candidates;
        if (!Array.isArray(rawCandidates) || !rawCandidates.length) {
            throw new Error("选品研究结果缺少 candidates 数组");
        }
        const seen = new Set();
        const candidates = rawCandidates.map((item) => {
            const data = (item ?? {});
            let candidateId = String(data.candidate_id ?? "").trim();
            if (!candidateId)
                candidateId = `sel_${randomUUID()}`;
            if (seen.has(candidateId))
                throw new Error(`选品候选重复：${candidateId}`);
            seen.add(candidateId);
            const recommendation = (data.recommendation ?? {});
            const bobRecommendationStatus = String(recommendation.bob_recommendation_status ?? "").trim();
            /* 兜底：若 AI 没给出 image_url / reference_product_links，从 competitor_set / evidence_refs 自动抽取 */
            const links = Array.isArray(data.reference_product_links) ? data.reference_product_links : [];
            const competitorLinks = (Array.isArray(data.competitor_set) ? data.competitor_set : [])
                .map((c) => c?.product_url)
                .filter((url) => typeof url === "string" && url.startsWith("http"));
            const evidenceLinks = (Array.isArray(parsed.evidence_refs) ? parsed.evidence_refs : [])
                .map((e) => e?.source_url)
                .filter((url) => typeof url === "string" && url.startsWith("http"));
            const mergedLinks = [...new Set([...links, ...competitorLinks, ...evidenceLinks])];
            const existingImage = typeof data.image_url === "string" && data.image_url.startsWith("http")
                ? data.image_url
                : "";
            const competitorImage = (Array.isArray(data.competitor_set) ? data.competitor_set : [])
                .map((c) => c?.product_image_url || c?.image_url)
                .find((url) => typeof url === "string" && url.startsWith("http"));
            const derivedImage = existingImage || competitorImage || mergedLinks[0] || "";
            return {
                ...data,
                candidate_id: candidateId,
                bob_recommendation_status: bobRecommendationStatus,
                image_url: derivedImage,
                reference_product_links: mergedLinks.length ? mergedLinks : (derivedImage ? [derivedImage] : [])
            };
        });
        return { ...parsed, candidates, evidence_refs: parsed.evidence_refs || [] };
    }
    async saveSelectionResult(text, parsed) {
        await mkdir(SELECTION_DIR, { recursive: true });
        /* 仅落盘研究交付（原始文本 + 结构化数据），不写入开发池（遵守 Bob 不自动写入铁律） */
        await Promise.all([
            writeFile(path.join(SELECTION_DIR, "00_PRODUCT_SELECTION.md"), `${text}\n`, "utf8"),
            writeFile(path.join(SELECTION_DIR, "00_PRODUCT_SELECTION_DATA.json"), `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
        ]);
        return parsed.candidates;
    }
    /* ── 磁盘兜底：当 run-state.json 中选品候选丢失但从磁盘文件可恢复时，自动恢复 ── */
    async recoverFromDisk() {
        const state = this.store.get();
        const sel = state.selection || {};
        if (Array.isArray(sel.candidates) && sel.candidates.length > 0)
            return false;
        const dataPath = path.join(SELECTION_DIR, "00_PRODUCT_SELECTION_DATA.json");
        const mdPath = path.join(SELECTION_DIR, "00_PRODUCT_SELECTION.md");
        try {
            const [dataRaw, mdRaw] = await Promise.all([
                readFile(dataPath, "utf8").catch(() => null),
                readFile(mdPath, "utf8").catch(() => null)
            ]);
            if (!dataRaw)
                return false;
            const parsed = JSON.parse(dataRaw);
            const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
            if (!candidates.length)
                return false;
            await this.store.update({
                selection: {
                    ...this.store.get().selection,
                    running: false,
                    stage: "DONE",
                    text: mdRaw || (sel.text || ""),
                    candidates,
                    evidenceRefs: parsed.evidence_refs || [],
                    chatUrl: sel.chatUrl ?? null,
                    updatedAt: sel.updatedAt ?? new Date().toISOString(),
                    message: "已从磁盘恢复上次选品研究结果"
                }
            });
            return true;
        }
        catch {
            return false;
        }
    }
    async readPool() {
        try {
            const value = JSON.parse(await readFile(SELECTION_CANDIDATES_FILE, "utf8"));
            return Array.isArray(value) ? value : [];
        }
        catch {
            return [];
        }
    }
    async writePool(entries) {
        await mkdir(path.dirname(SELECTION_CANDIDATES_FILE), { recursive: true });
        await enqueueFileWrite(SELECTION_CANDIDATES_FILE, async () => {
            const temporary = `${SELECTION_CANDIDATES_FILE}.${process.pid}.${Date.now()}.tmp`;
            await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
            await rename(temporary, SELECTION_CANDIDATES_FILE);
        });
    }
    /* ── 人工采纳：仅当点击时才写 selection-candidates.json（开发池交接），不自动写 ── */
    async adoptCandidate(candidateId, decision) {
        const state = this.store.get();
        if (state.selection.running)
            throw new Error("选品研究运行中，暂不能采纳候选");
        if (!ALLOWED_DECISIONS.includes(decision))
            throw new Error("非法的采纳决策，必须是 approved_for_development_pool / observe_pool / rejected / manual_review / blocked_by_risk");
        const candidate = (state.selection.candidates ?? []).find((item) => item.candidate_id === candidateId);
        if (!candidate)
            throw new Error("未找到该候选，可能尚未运行选品研究");
        const pool = await this.readPool();
        const entry = {
            candidateId,
            decision,
            decidedAt: new Date().toISOString(),
            runId: state.selection.input?.runId ?? null,
            sourceChatUrl: state.selection.chatUrl ?? null,
            candidate
        };
        const index = pool.findIndex((item) => item.candidateId === candidateId);
        if (index >= 0)
            pool[index] = { ...pool[index], ...entry };
        else
            pool.push(entry);
        await this.writePool(pool);
        await this.store.update({
            selection: {
                ...state.selection,
                decided: { ...state.selection.decided, [candidateId]: decision }
            }
        });
        return this.store.get();
    }
    async importFromCurrentChat() {
        const state = this.store.get();
        if (state.selection.running)
            throw new Error("选品研究运行中，不能导入");
        const readiness = await this.ai.checkReady();
        if (!readiness.ready)
            throw new Error(`${this.providerName(state.provider)} 尚未登录`);
        const text = await this.ai.recoverCompletedResponse(SELECTION_FINGERPRINT);
        if (!text)
            throw new Error("当前 ChatGPT 会话中未找到 Bob 选品研究结果（请确认页面已包含 # 选品研究 Bob v0.1 的提示及回复）");
        const parsed = this.parseSelectionResult(text);
        await this.saveSelectionResult(text, parsed);
        await this.store.update({
            selection: {
                ...state.selection,
                running: false,
                stage: "DONE",
                text,
                candidates: parsed.candidates,
                evidenceRefs: parsed.evidence_refs || [],
                chatUrl: this.ai.currentUrl(),
                updatedAt: new Date().toISOString(),
                message: "已从当前 ChatGPT 聊天页导入 Bob 选品研究结果"
            }
        });
        return { imported: true, count: parsed.candidates.length };
    }
    /* ── 启动复位：进程重启后不存在后台任务，清理遗留的 running 状态，避免卡死 ── */
    async clearStaleRunning() {
        const sel = this.store.get().selection || {};
        if (!sel.running)
            return;
        await this.store.update({
            selection: {
                ...sel,
                running: false,
                stage: "IDLE",
                error: undefined,
                message: "检测到上次标品选品研究被中断，已自动复位，可重新运行"
            }
        });
    }
    async resetSelection() {
        const state = this.store.get();
        if (state.selection.running)
            throw new Error("选品研究运行中，不能重置");
        /* 只清 state，保留 selection-candidates.json 与 SELECTION_DIR 交付文件（规避 safe-delete 批量删除） */
        await this.store.update({
            selection: {
                running: false,
                stage: "IDLE",
                input: null,
                text: "",
                candidates: [],
                updatedAt: null,
                chatUrl: null,
                decided: {},
                error: undefined
            }
        });
        return this.store.get();
    }
    /* ── 图片解析：从产品页或图片直链解析出可预览的图片 URL ── */
    isUsableImageUrl(value) {
        try {
            if (!value || typeof value !== "string")
                return false;
            const url = new URL(value.trim());
            return url.protocol === "https:" || url.protocol === "http:";
        }
        catch {
            return false;
        }
    }
    looksLikeImageUrl(value) {
        return /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(String(value || "").trim());
    }
    async resolveSelectionImageUrl(value) {
        const candidates = await this.resolveSelectionImageUrls(value);
        return candidates[0];
    }
    async resolveSelectionImageUrls(value) {
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
                "user-agent": "Yikuaerjing-Selection/1.0"
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
        for (const match of html.matchAll(/<link[^>]+(?:rel=["'][^"']*(?:image_src|preload)[^"']*["'][^>]+href=["']([^"']+)["']|href=["']([^"']+)["'][^>]+rel=["'][^"']*(?:image_src|preload)["'][^>]*)>/gi)) {
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
                const found = this.findImageInJsonLd(item);
                if (found)
                    return found;
            }
            return undefined;
        }
        if (typeof value === "object") {
            for (const key of ["image", "imageUrl", "image_url", "img", "thumbnailUrl", "contentUrl"]) {
                if (value[key]) {
                    const found = this.findImageInJsonLd(value[key]);
                    if (found)
                        return found;
                }
            }
        }
        return undefined;
    }
    async fail(error) {
        const state = this.store.get();
        const raw = error instanceof Error ? error.message : String(error);
        const userMessage = /frame was detached|target closed|execution context was destroyed|page closed|browser is not connected/i.test(raw)
            ? "ChatGPT 页面连接中断（Frame detached）。请确认专用 Chrome 已启动且未崩溃，然后点击「运行 Bob 选品研究」重试。"
            : "标品选品已暂停，修复后可重新运行";
        await this.store.update({
            selection: {
                ...state.selection,
                running: false,
                stage: "IDLE",
                message: userMessage,
                error: raw
            }
        });
    }
}
//# sourceMappingURL=product-selection-service.js.map
