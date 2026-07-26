import * as XLSX from "xlsx";
import path from "node:path";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import {
    HIDDEN_DATA_DIR,
    OUTPUT_DIR,
    PRODUCT_IMAGES_DIR,
    PRODUCT_PROFILE_FILE,
    PRODUCT_ROOT,
    USER_DATA_DIR
} from "./config.js";
import { clearProductImages, importProductImageUrls } from "./image-files.js";
import { archiveCurrentProduct } from "./product-session.js";

const MAX_ROWS = 50;
const MAX_URLS_PER_ROW = 20;
const URL_CHUNK_SIZE = 12;

const listingCreateRunState = {
    running: false,
    jobId: null,
    startedAt: null,
    finishedAt: null,
    overallProgress: 0,
    summary: null,
    items: {},
    filePath: null
};

function col(header, re) {
    const idx = header.findIndex((h) => re.test(String(h || "").trim()));
    return idx >= 0 ? idx : -1;
}

function normalizeMode(v) {
    const s = String(v || "").trim().toLowerCase();
    if (s === "seo" || s === "seo_content_only" || s === "仅seo" || s === "仅 seo 与商品文案" || s === "seo文案") {
        return "seo_content_only";
    }
    if (s === "full" || s === "full_listing" || s === "完整listing" || s === "完整 Listing" || s === "完整") {
        return "full_listing";
    }
    return "full_listing";
}

function parseRows(aoa) {
    if (!aoa || aoa.length < 2) {
        return { rows: [], warnings: ["表格为空或没有数据行"] };
    }
    const header = (aoa[0] || []).map((h) => String(h || "").trim());
    const idxName = col(header, /^(productName|产品名|产品名称|商品名)$/);
    const idxMode = col(header, /^(mode|模式|流程模式)$/);
    const idxCategory = col(header, /^(category|类目|类别)$/);
    const idxNotes = col(header, /^(notes|备注|说明)$/);
    const idxUrls = col(header, /^(imageUrls|图片链接|图片地址|图片URL|图片网址)$/);
    const urlCols = header
        .map((h, i) => (/^imageUrl_\d+$/i.test(String(h || "")) ? i : -1))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);

    if (idxName < 0) {
        return { rows: [], warnings: ["未找到 productName/产品名 列，请使用标准模板"] };
    }

    const rows = [];
    const warnings = [];
    for (let i = 1; i < aoa.length; i++) {
        const cols = aoa[i] || [];
        const productName = String(cols[idxName] || "").trim();
        if (!productName) {
            warnings.push(`第 ${i + 1} 行 productName 为空，已跳过`);
            continue;
        }
        const urls = [];
        if (idxUrls >= 0) {
            const raw = String(cols[idxUrls] || "");
            urls.push(...raw.split(/[,，;；\n]/).map((s) => s.trim()).filter(Boolean));
        }
        for (const c of urlCols) {
            const v = String(cols[c] || "").trim();
            if (v)
                urls.push(v);
        }
        const deduped = [...new Set(urls)];
        if (deduped.length > MAX_URLS_PER_ROW) {
            warnings.push(`第 ${i + 1} 行图片 URL 超过 ${MAX_URLS_PER_ROW} 个，已截断`);
            deduped.length = MAX_URLS_PER_ROW;
        }
        rows.push({
            index: rows.length,
            productName,
            mode: normalizeMode(cols[idxMode]),
            category: idxCategory >= 0 ? String(cols[idxCategory] || "").trim() : "",
            notes: idxNotes >= 0 ? String(cols[idxNotes] || "").trim() : "",
            imageUrls: deduped
        });
    }
    if (rows.length > MAX_ROWS) {
        warnings.push(`行数超过 ${MAX_ROWS}，仅处理前 ${MAX_ROWS} 行`);
        return { rows: rows.slice(0, MAX_ROWS), warnings };
    }
    return { rows, warnings };
}

async function downloadImageUrlsChunked(urls) {
    const imported = [];
    const rejected = [];
    const skippedDuplicates = [];
    for (let i = 0; i < urls.length; i += URL_CHUNK_SIZE) {
        const chunk = urls.slice(i, i + URL_CHUNK_SIZE);
        try {
            const r = await importProductImageUrls(chunk);
            imported.push(...r.imported);
            rejected.push(...r.rejected);
            skippedDuplicates.push(...(r.skippedDuplicates || []));
        }
        catch (error) {
            rejected.push(...chunk);
        }
    }
    return { imported, rejected, skippedDuplicates };
}

async function scanArchiveArtifacts(archiveDir) {
    const out = [];
    async function walk(dir, prefix) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            const rel = prefix ? `${prefix}/${e.name}` : e.name;
            if (e.isDirectory()) {
                await walk(path.join(dir, e.name), rel);
            }
            else if (!["run-state.json", "product-profile.json"].includes(e.name)) {
                out.push(rel);
            }
        }
    }
    try {
        await walk(archiveDir, "");
    }
    catch {
        // 目录可能不存在或为空
    }
    return out.sort();
}

async function snapshotListingCreate(jobId) {
    const dir = path.join(HIDDEN_DATA_DIR, "batch-listing-create", jobId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "state.json"), JSON.stringify({
        running: listingCreateRunState.running,
        jobId: listingCreateRunState.jobId,
        startedAt: listingCreateRunState.startedAt,
        finishedAt: listingCreateRunState.finishedAt,
        overallProgress: listingCreateRunState.overallProgress,
        summary: listingCreateRunState.summary,
        items: listingCreateRunState.items
    }, null, 2), "utf8");
}

async function writeBatchListingCreateResults(filePath, resultsByIndex, rowCount) {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const header = aoa[0] || [];
    const extra = ["status", "currentStage", "outputDirectory", "artifacts", "reason"];
    for (const h of extra) {
        header.push(h);
    }
    for (let i = 1; i <= rowCount; i++) {
        if (!aoa[i])
            aoa[i] = [];
        const r = resultsByIndex[i - 1] || {
            status: "pending",
            currentStage: "",
            outputDirectory: "",
            artifacts: [],
            reason: ""
        };
        aoa[i].push(r.status, r.currentStage, r.outputDirectory, r.artifacts.join("\n"), r.reason);
    }
    const newWs = XLSX.utils.aoa_to_sheet(aoa);
    wb.Sheets[wb.SheetNames[0]] = newWs;
    try {
        await copyFile(filePath, `${filePath}.bak`);
    }
    catch {
        // 备份失败不影响主流程
    }
    XLSX.writeFile(wb, filePath);
}

async function runBatchListingCreate(jobId, rows, filePath, deps) {
    const { store, standardService, productProfiles, getBatchRunStateRunning } = deps;

    listingCreateRunState.running = true;
    listingCreateRunState.jobId = jobId;
    listingCreateRunState.startedAt = new Date().toISOString();
    listingCreateRunState.finishedAt = null;
    listingCreateRunState.overallProgress = 0;
    listingCreateRunState.summary = null;
    listingCreateRunState.items = {};
    listingCreateRunState.filePath = filePath;

    const resultsByIndex = {};
    let success = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const item = {
            productName: row.productName,
            mode: row.mode,
            status: "running",
            currentStage: "INIT",
            progress: 0,
            outputDirectory: "",
            artifacts: [],
            reason: "",
            log: []
        };
        listingCreateRunState.items[String(i)] = item;
        const result = {
            status: "failed",
            currentStage: "",
            outputDirectory: "",
            artifacts: [],
            reason: ""
        };

        try {
            if (getBatchRunStateRunning && getBatchRunStateRunning()) {
                throw new Error("ERP 批量上架正在运行，无法同时执行批量上品");
            }

            // (1) 行级隔离：重置工作区
            await store.reset(`批量上品 第 ${i + 1}/${rows.length} 行：${row.productName}`);
            await clearProductImages();
            await rm(OUTPUT_DIR, { recursive: true, force: true });
            await mkdir(OUTPUT_DIR, { recursive: true });
            await rm(PRODUCT_PROFILE_FILE, { force: true });

            // (2) 设置模式与客观信息
            const objectiveParts = [`产品名：${row.productName}`];
            if (row.category)
                objectiveParts.push(`类目：${row.category}`);
            if (row.notes)
                objectiveParts.push(`补充信息：${row.notes}`);
            await store.update({
                workflowMode: "standard_listing",
                standardWorkflowGoal: row.mode,
                provider: "chatgpt",
                objectiveInfo: objectiveParts.join("\n"),
                batchProductName: row.productName
            });
            item.progress = 10;

            // (3) 下载图片
            if (row.imageUrls.length) {
                const dl = await downloadImageUrlsChunked(row.imageUrls);
                item.log.push(`下载图片：导入 ${dl.imported.length}，拒绝 ${dl.rejected.length}，去重跳过 ${dl.skippedDuplicates.length}`);
                if (!dl.imported.length && row.mode !== "seo_content_only") {
                    throw new Error("未成功下载任何产品图");
                }
            }
            else if (row.mode !== "seo_content_only") {
                throw new Error("full_listing 模式必须提供至少一张图片 URL");
            }
            item.progress = 25;

            // (4) 跑单品 Listing 流水线
            await standardService.runAll();
            const st = store.get();
            item.currentStage = st.stage;

            if (st.stage === "COMPLETED" && st.completedPhase === "MVP5") {
                const archiveDir = await archiveCurrentProduct(st);
                await productProfiles.archiveCurrent(archiveDir).catch(() => { });
                result.status = "done";
                result.currentStage = "COMPLETED";
                result.outputDirectory = path.relative(USER_DATA_DIR, archiveDir);
                result.artifacts = await scanArchiveArtifacts(archiveDir);
                item.status = "done";
                success += 1;
            }
            else {
                result.status = "failed";
                result.currentStage = st.stage;
                result.reason = st.error || `流程未正常完成，stage=${st.stage}`;
                item.status = "failed";
                failed += 1;
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.status = "failed";
            result.reason = message;
            result.currentStage = store.get().stage;
            item.status = "failed";
            item.currentStage = result.currentStage;
            item.log.push(`错误：${message}`);
            failed += 1;
        }

        item.progress = 100;
        item.outputDirectory = result.outputDirectory;
        item.artifacts = result.artifacts;
        item.reason = result.reason;
        resultsByIndex[i] = result;
        listingCreateRunState.overallProgress = Math.round((i + 1) / rows.length * 100);
        await snapshotListingCreate(jobId);
    }

    await writeBatchListingCreateResults(filePath, resultsByIndex, rows.length);
    listingCreateRunState.running = false;
    listingCreateRunState.finishedAt = new Date().toISOString();
    listingCreateRunState.summary = { success, failed, skipped: 0, total: rows.length };
    await snapshotListingCreate(jobId);
}

export function registerBatchListingCreateRoutes(app, deps) {
    const { upload, store, standardService, productProfiles, runBackground, getBatchRunStateRunning } = deps;

    app.post("/api/batch-listing-create/upload", upload.single("workbook"), async (request, response) => {
        try {
            if (!request.file || !request.file.buffer) {
                return response.status(400).json({ ok: false, error: "未上传文件" });
            }
            const wb = XLSX.read(request.file.buffer, { type: "array" });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
            const { rows, warnings } = parseRows(aoa);
            if (!rows.length) {
                return response.status(400).json({ ok: false, error: "表格中没有有效行", warnings });
            }
            const jobId = `blc-${Date.now()}`;
            const dir = path.join(HIDDEN_DATA_DIR, "batch-listing-create", jobId);
            await mkdir(dir, { recursive: true });
            const filePath = path.join(dir, "input.xlsx");
            await writeFile(filePath, request.file.buffer);

            listingCreateRunState.jobId = jobId;
            listingCreateRunState.filePath = filePath;

            return response.json({
                ok: true,
                jobId,
                rows: rows.map((r) => ({
                    productName: r.productName,
                    mode: r.mode,
                    category: r.category,
                    notes: r.notes,
                    imageCount: r.imageUrls.length
                })),
                warnings
            });
        }
        catch (error) {
            console.error("batch-listing-create upload error:", error);
            const message = error instanceof Error ? error.message : String(error);
            return response.status(500).json({ ok: false, error: message });
        }
    });

    app.post("/api/batch-listing-create/start", async (request, response) => {
        try {
            const { jobId } = request.body || {};
            if (!jobId || !listingCreateRunState.filePath || listingCreateRunState.jobId !== jobId) {
                return response.status(400).json({ ok: false, error: "jobId 无效或文件未上传" });
            }
            if (listingCreateRunState.running) {
                return response.status(409).json({ ok: false, error: "已有批量上品任务正在运行" });
            }
            const st = store.get();
            if (st.running || st.autoRun) {
                return response.status(409).json({ ok: false, error: "单品流程正在运行" });
            }
            if (getBatchRunStateRunning && getBatchRunStateRunning()) {
                return response.status(409).json({ ok: false, error: "ERP 批量上架正在运行" });
            }

            const buf = await readFile(listingCreateRunState.filePath);
            const wb = XLSX.read(buf, { type: "array" });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
            const { rows, warnings } = parseRows(aoa);
            if (!rows.length) {
                return response.status(400).json({ ok: false, error: "表格中没有有效行", warnings });
            }

            runBackground(() => runBatchListingCreate(jobId, rows, listingCreateRunState.filePath, deps));
            return response.json({ ok: true, jobId, accepted: true });
        }
        catch (error) {
            console.error("batch-listing-create start error:", error);
            const message = error instanceof Error ? error.message : String(error);
            return response.status(500).json({ ok: false, error: message });
        }
    });

    app.get("/api/batch-listing-create/status", async (request, response) => {
        try {
            const items = Object.values(listingCreateRunState.items).map((it) => ({
                productName: it.productName,
                mode: it.mode,
                status: it.status,
                currentStage: it.currentStage,
                progress: it.progress,
                outputDirectory: it.outputDirectory,
                artifacts: it.artifacts,
                reason: it.reason
            }));
            return response.json({
                ok: true,
                running: listingCreateRunState.running,
                jobId: listingCreateRunState.jobId,
                overallProgress: listingCreateRunState.overallProgress,
                summary: listingCreateRunState.summary,
                items
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return response.status(500).json({ ok: false, error: message });
        }
    });

    app.get("/api/batch-listing-create/download", async (request, response) => {
        try {
            const { jobId } = request.query || {};
            if (!jobId || listingCreateRunState.jobId !== jobId || !listingCreateRunState.filePath) {
                return response.status(404).json({ ok: false, error: "未找到结果文件" });
            }
            return response.sendFile(path.resolve(listingCreateRunState.filePath), {
                headers: {
                    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "Content-Disposition": "attachment; filename=\"batch-listing-result.xlsx\""
                }
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return response.status(500).json({ ok: false, error: message });
        }
    });
}
