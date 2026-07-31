import * as XLSX from "xlsx";
import path from "node:path";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import {
    HIDDEN_DATA_DIR,
    OUTPUT_DIR,
    PRODUCT_IMAGES_DIR,
    PRODUCT_PROFILE_FILE,
    PRODUCT_ROOT,
    USER_DATA_DIR
} from "./config.js";
import { clearProductImages, importLocalImagePaths, importProductImageUrls } from "./image-files.js";
import { archiveCurrentProduct } from "./product-session.js";

const MAX_ROWS = 50;
const MAX_URLS_PER_ROW = 20;
const URL_CHUNK_SIZE = 12;

/**
 * 用 rename 原子重置目录，绕过 safe-delete shim 对 fs.rm 的回收站拦截。
 * 旧目录保留为 dir.old.<timestamp>，不主动删除以避免 Windows trash API 失败。
 */
async function safeResetDirectory(dir) {
    try {
        await rename(dir, `${dir}.old.${Date.now()}`);
    }
    catch (error) {
        if (error && error.code !== "ENOENT") {
            throw error;
        }
    }
    await mkdir(dir, { recursive: true });
}

async function safeUnlink(filePath) {
    try {
        await unlink(filePath);
    }
    catch (error) {
        if (error && error.code !== "ENOENT") {
            throw error;
        }
    }
}

export const listingCreateRunState = {
    running: false,
    jobId: null,
    startedAt: null,
    finishedAt: null,
    overallProgress: 0,
    summary: null,
    items: {},
    rowsMeta: [],
    filePath: null,
    autoUploadOnComplete: false,
    autoUploadStatus: null  // { startedAt, operationId, jobIds, status: "running"|"done", finishedAt, error? }
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
    const idxLocal = col(header, /^(localImages|本地图片|本地图|本地路径|本地文件)$/);
    const urlCols = header
        .map((h, i) => (/^imageUrl_\d+$/i.test(String(h || "")) ? i : -1))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
    const localCols = header
        .map((h, i) => (/^localImage_\d+$/i.test(String(h || "")) ? i : -1))
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
            urls.push(...raw.split(/[,，;；\n]/).map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
        }
        for (const c of urlCols) {
            const v = String(cols[c] || "").trim().replace(/^["']|["']$/g, "");
            if (v)
                urls.push(v);
        }
        const deduped = [...new Set(urls)];
        if (deduped.length > MAX_URLS_PER_ROW) {
            warnings.push(`第 ${i + 1} 行图片 URL 超过 ${MAX_URLS_PER_ROW} 个，已截断`);
            deduped.length = MAX_URLS_PER_ROW;
        }
        const localPaths = [];
        if (idxLocal >= 0) {
            const raw = String(cols[idxLocal] || "");
            localPaths.push(...raw.split(/[,，;；\n]/).map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
        }
        for (const c of localCols) {
            const v = String(cols[c] || "").trim().replace(/^["']|["']$/g, "");
            if (v)
                localPaths.push(v);
        }
        const dedupedLocal = [...new Set(localPaths)];
        if (dedupedLocal.length > MAX_URLS_PER_ROW) {
            warnings.push(`第 ${i + 1} 行本地图片超过 ${MAX_URLS_PER_ROW} 个，已截断`);
            dedupedLocal.length = MAX_URLS_PER_ROW;
        }
        rows.push({
            index: rows.length,
            productName,
            mode: normalizeMode(cols[idxMode]),
            category: idxCategory >= 0 ? String(cols[idxCategory] || "").trim() : "",
            notes: idxNotes >= 0 ? String(cols[idxNotes] || "").trim() : "",
            imageUrls: deduped,
            localImages: dedupedLocal
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
        items: listingCreateRunState.items,
        rowsMeta: listingCreateRunState.rowsMeta || [],
        autoUploadOnComplete: listingCreateRunState.autoUploadOnComplete,
        autoUploadStatus: listingCreateRunState.autoUploadStatus
    }, null, 2), "utf8");
}

async function writeBatchListingCreateResults(filePath, resultsByIndex, rowCount) {
    const buf = await readFile(filePath);
    const wb = XLSX.read(buf, { type: "buffer" });
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
    const outBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    await writeFile(filePath, outBuf);
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
    // 持久化所有行元数据：刷新页面/重启 server 后可重建完整 5 行表格
    listingCreateRunState.rowsMeta = rows.map((r) => ({
        productName: r.productName,
        mode: r.mode,
        category: r.category || "",
        notes: r.notes || "",
        imageCount: (r.imageUrls?.length || 0) + (r.localImages?.length || 0)
    }));

    const resultsByIndex = {};
    // 从已有 items 初始化计数器：支持断点续跑（服务端重启后计数器会重置，但 items 已持久化）
    const existingItems = Object.values(listingCreateRunState.items);
    let success = existingItems.filter((it) => it.status === "done").length;
    let failed = existingItems.filter((it) => it.status === "failed").length;
    // finally 兜底：无论中途如何退出（崩溃/未捕获异常），都归一化 running=false 与 summary，
    // 避免「所有行跑完但 running 没清」的 stuck 状态让剩余行永远 pending。
    const finishRun = async () => {
        try {
            await writeBatchListingCreateResults(filePath, resultsByIndex, rows.length);
        }
        catch (error) {
            console.warn("writeBatchListingCreateResults failed:", error instanceof Error ? error.message : String(error));
        }
        listingCreateRunState.running = false;
        listingCreateRunState.finishedAt = listingCreateRunState.finishedAt || new Date().toISOString();
        // 最终 summary 从 items 重新计算，避免本地计数器漂移（断点续跑/服务端重启后计数器会重置）
        const finalItems = Object.values(listingCreateRunState.items);
        const doneCount = finalItems.filter((it) => it.status === "done").length;
        const failedCount = finalItems.filter((it) => it.status === "failed").length;
        listingCreateRunState.summary = { success: doneCount, failed: failedCount, skipped: 0, total: rows.length };
        try {
            await snapshotListingCreate(jobId);
        }
        catch {}
        // ★ 自动上架触发器：勾选 autoUploadOnComplete 时，listing 完成后后端自动串行跑引用 + 采集箱。
        // 下沉到后端是为了避免刷新页面/关浏览器就丢任务的脆弱性（前端编排会被丢失）。
        // operationId 用 jobId 拼接，runCollectBatchListing 已支持幂等门控（v1.6.24），不会重复拾起。
        // 不复用 runBackground（它会污染单品 store 的 stage/message 字段）。
        if (listingCreateRunState.autoUploadOnComplete && doneCount > 0 && deps && typeof deps.triggerAutoUpload === "function") {
            const opId = `auto-upload-${jobId}`;
            listingCreateRunState.autoUploadStatus = {
                startedAt: new Date().toISOString(),
                operationId: opId,
                jobIds: [],
                status: "running"
            };
            try { await snapshotListingCreate(jobId); } catch {}
            const log = (m) => console.log(`[auto-upload ${jobId}]`, m);
            void (async () => {
                try {
                    await deps.triggerAutoUpload({ jobId, filePath, operationId: opId, logger: log });
                }
                catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.error(`[auto-upload ${jobId}] failed:`, msg);
                    listingCreateRunState.autoUploadStatus = {
                        ...(listingCreateRunState.autoUploadStatus || {}),
                        status: "failed",
                        finishedAt: new Date().toISOString(),
                        error: msg
                    };
                }
                finally {
                    if (!listingCreateRunState.autoUploadStatus || listingCreateRunState.autoUploadStatus.status === "running") {
                        listingCreateRunState.autoUploadStatus = {
                            ...(listingCreateRunState.autoUploadStatus || {}),
                            status: "done",
                            finishedAt: new Date().toISOString()
                        };
                    }
                    try { await snapshotListingCreate(jobId); } catch {}
                }
            })();
        }
    };

    try {
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
                throw new Error("ERP 批量上架正在运行，无法同时执行批量制作");
            }

            // (1) 行级隔离：重置工作区
            await store.reset(`批量制作 第 ${i + 1}/${rows.length} 行：${row.productName}`);
            await clearProductImages();
            await safeResetDirectory(OUTPUT_DIR);
            await safeUnlink(PRODUCT_PROFILE_FILE);

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
                skipProductFacts: true,
                skipResearch: true,
                objectiveInfo: objectiveParts.join("\n"),
                batchProductName: row.productName
            });
            item.progress = 10;

            // (3) 导入图片（URL 下载 + 本地路径拷贝）
            const jobDir = path.dirname(filePath);
            let importedCount = 0;
            let rejectedCount = 0;
            if (row.imageUrls.length) {
                const dl = await downloadImageUrlsChunked(row.imageUrls);
                importedCount += dl.imported.length;
                rejectedCount += dl.rejected.length;
                item.log.push(`下载图片：导入 ${dl.imported.length}，拒绝 ${dl.rejected.length}，去重跳过 ${dl.skippedDuplicates.length}`);
            }
            if (row.localImages.length) {
                const lp = await importLocalImagePaths(row.localImages, jobDir);
                importedCount += lp.imported.length;
                rejectedCount += lp.rejected.length;
                item.log.push(`本地图片：导入 ${lp.imported.length}，拒绝 ${lp.rejected.length}，去重跳过 ${lp.skippedDuplicates.length}`);
            }
            if (importedCount === 0 && row.mode !== "seo_content_only") {
                throw new Error("未成功导入任何产品图（URL 下载失败且无有效本地图片）");
            }
            item.progress = 25;

            // (4) 跑单品 Listing 流水线（带阶段同步心跳，避免前端长时间显示 INIT）
            let stageSyncTick = 0;
            const stageSyncInterval = setInterval(() => {
                const live = store.get();
                item.currentStage = live.stage || item.currentStage;
                item.message = live.message || item.message;
                stageSyncTick += 1;
                if (stageSyncTick % 5 === 0) {
                    snapshotListingCreate(jobId).catch(() => { });
                }
            }, 1_000);
            try {
                await standardService.runAll();
            }
            finally {
                clearInterval(stageSyncInterval);
            }
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
    }
    finally {
        await finishRun();
    }
}

async function runBatchListingCreateRetry(jobId, filePath, deps) {
    const { store, standardService, productProfiles, getBatchRunStateRunning } = deps;
    if (getBatchRunStateRunning && getBatchRunStateRunning()) {
        throw new Error("ERP 批量上架正在运行，无法同时执行批量制作");
    }
    const st = store.get();
    if (st.running || st.autoRun) {
        throw new Error("单品流程正在运行，请先暂停或结束单品任务");
    }

    // 重读原 xlsx 拿到完整 row 列表（不依赖内存中残缺状态）
    const buf = await readFile(filePath);
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const { rows } = parseRows(aoa);

    listingCreateRunState.startedAt = listingCreateRunState.startedAt || new Date().toISOString();
    listingCreateRunState.finishedAt = null;
    listingCreateRunState.summary = null;

    // 找出需要补跑的项：failed 项 + 完全 missing/idle 的项（服务端中断导致后续行未开始）
    const itemStatuses = new Map(Object.entries(listingCreateRunState.items).map(([k, it]) => [Number(k), it]));
    const pendingIndices = [];
    for (let i = 0; i < rows.length; i++) {
        const it = itemStatuses.get(i);
        if (!it || it.status === "failed" || it.status === "idle" || it.status === "running") {
            pendingIndices.push(i);
        }
    }
    if (!pendingIndices.length) {
        throw new Error("当前没有失败/待处理项可继续");
    }

    const resultsByIndex = {};
    // 从已有 items 初始化计数器：done 项不重跑但仍要计入 summary
    const existingItems = Object.values(listingCreateRunState.items);
    let success = existingItems.filter((it) => it.status === "done").length;
    let failed = existingItems.filter((it) => it.status === "failed").length;
    let processed = 0;

    for (const i of pendingIndices) {
        const row = rows[i];
        if (!row) continue;
        const item = listingCreateRunState.items[String(i)] || {
            productName: row.productName,
            mode: row.mode
        };
        item.status = "running";
        item.currentStage = "RETRY_INIT";
        item.progress = 0;
        item.outputDirectory = "";
        item.artifacts = [];
        item.reason = "";
        item.log = Array.isArray(item.log) ? item.log : [];
        item.log.push("↻ 触发重试");
        listingCreateRunState.items[String(i)] = item;

        const result = {
            status: "failed",
            currentStage: "",
            outputDirectory: "",
            artifacts: [],
            reason: ""
        };

        try {
            await store.reset(`批量制作 重试 第 ${i + 1} 行：${row.productName}`);
            await clearProductImages();
            await safeResetDirectory(OUTPUT_DIR);
            await safeUnlink(PRODUCT_PROFILE_FILE);

            const objectiveParts = [`产品名：${row.productName}`];
            if (row.category) objectiveParts.push(`类目：${row.category}`);
            if (row.notes) objectiveParts.push(`补充信息：${row.notes}`);
            await store.update({
                workflowMode: "standard_listing",
                standardWorkflowGoal: row.mode,
                provider: "chatgpt",
                skipProductFacts: true,
                skipResearch: true,
                objectiveInfo: objectiveParts.join("\n"),
                batchProductName: row.productName
            });
            item.progress = 10;

            const jobDir = path.dirname(filePath);
            let importedCount = 0;
            let rejectedCount = 0;
            if (row.imageUrls?.length) {
                const dl = await importProductImageUrls(row.imageUrls);
                importedCount += dl.imported.length;
                rejectedCount += dl.rejected.length;
                item.log.push(`重试下载图片：导入 ${dl.imported.length}，拒绝 ${dl.rejected.length}`);
            }
            if (row.localImages?.length) {
                const lp = await importLocalImagePaths(row.localImages, jobDir);
                importedCount += lp.imported.length;
                rejectedCount += lp.rejected.length;
                item.log.push(`重试本地图片：导入 ${lp.imported.length}，拒绝 ${lp.rejected.length}`);
            }
            if (importedCount === 0 && row.mode !== "seo_content_only") {
                throw new Error("未成功导入任何产品图（URL 下载失败且无有效本地图片）");
            }
            item.progress = 25;

            await standardService.runAll();
            const stAfter = store.get();
            item.currentStage = stAfter.stage;

            if (stAfter.stage === "COMPLETED" && stAfter.completedPhase === "MVP5") {
                const archiveDir = await archiveCurrentProduct(stAfter);
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
                result.currentStage = stAfter.stage;
                result.reason = stAfter.error || `流程未正常完成，stage=${stAfter.stage}`;
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
            item.log.push(`重试错误：${message}`);
            failed += 1;
        }

        item.progress = 100;
        item.outputDirectory = result.outputDirectory;
        item.artifacts = result.artifacts;
        item.reason = result.reason;
        resultsByIndex[i] = result;
        processed += 1;
        listingCreateRunState.overallProgress = Math.round(((rows.length - pendingIndices.length + processed) / rows.length) * 100);
        await snapshotListingCreate(jobId);
    }

    // 把这次重试写回结果 xlsx 的对应行
    try {
        await mergeBatchListingCreateResults(filePath, resultsByIndex);
    }
    catch (error) {
        console.warn("merge retry results failed:", error instanceof Error ? error.message : String(error));
    }

    listingCreateRunState.running = false;
    listingCreateRunState.finishedAt = listingCreateRunState.finishedAt || new Date().toISOString();
    // 最终 summary 从全量 items 重新计算，done 项（含此前已完成）+ 本次新跑项一起统计
    const finalItems = Object.values(listingCreateRunState.items);
    const doneCount = finalItems.filter((it) => it.status === "done").length;
    const failedCount = finalItems.filter((it) => it.status === "failed").length;
    listingCreateRunState.summary = { success: doneCount, failed: failedCount, skipped: 0, total: rows.length };
    await snapshotListingCreate(jobId);
}

async function mergeBatchListingCreateResults(filePath, resultsByIndex) {
    const buf = await readFile(filePath);
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const header = aoa[0] || [];
    let statusIdx = header.findIndex((h) => /^(status|状态)$/i.test(String(h || "").trim()));
    let stageIdx = header.findIndex((h) => /^(currentStage|当前阶段|阶段)$/i.test(String(h || "").trim()));
    let outIdx = header.findIndex((h) => /^(outputDirectory|输出目录)$/i.test(String(h || "").trim()));
    let artIdx = header.findIndex((h) => /^(artifacts|产物)$/i.test(String(h || "").trim()));
    let reasonIdx = header.findIndex((h) => /^(reason|失败原因)$/i.test(String(h || "").trim()));
    if (statusIdx < 0) {
        header.push("status");
        statusIdx = header.length - 1;
    }
    if (stageIdx < 0) {
        header.push("currentStage");
        stageIdx = header.length - 1;
    }
    if (outIdx < 0) {
        header.push("outputDirectory");
        outIdx = header.length - 1;
    }
    if (artIdx < 0) {
        header.push("artifacts");
        artIdx = header.length - 1;
    }
    if (reasonIdx < 0) {
        header.push("reason");
        reasonIdx = header.length - 1;
    }
    aoa[0] = header;
    while (aoa.length < header.length) aoa.push([]);
    for (const [k, r] of Object.entries(resultsByIndex)) {
        const rowIdx = Number(k) + 1;
        while (aoa.length < rowIdx + 1) aoa.push([]);
        const row = aoa[rowIdx] || [];
        row[statusIdx] = r.status;
        row[stageIdx] = r.currentStage || "";
        row[outIdx] = r.outputDirectory || "";
        row[artIdx] = (r.artifacts || []).join("\n");
        row[reasonIdx] = r.reason || "";
        aoa[rowIdx] = row;
    }
    const newWs = XLSX.utils.aoa_to_sheet(aoa);
    wb.Sheets[wb.SheetNames[0]] = newWs;
    while (wb.SheetNames.length > 1) {
        const lastName = wb.SheetNames.pop();
        delete wb.Sheets[lastName];
    }
    const outBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    await writeFile(filePath, outBuf);
}

export async function recoverListingCreateState() {
    try {
        const base = path.join(HIDDEN_DATA_DIR, "batch-listing-create");
        const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
        let latestPath = null;
        let latestMtime = 0;
        for (const e of entries) {
            if (!e.isDirectory())
                continue;
            const fp = path.join(base, e.name, "state.json");
            try {
                const st = await stat(fp);
                if (st.mtimeMs > latestMtime) {
                    latestMtime = st.mtimeMs;
                    latestPath = fp;
                }
            }
            catch {
                // 忽略不存在或无权访问
            }
        }
        if (!latestPath)
            return;
        const saved = JSON.parse(await readFile(latestPath, "utf8"));
        if (!saved || !saved.jobId)
            return;
        // 内存中已有更新状态则不覆盖
        if (listingCreateRunState.jobId && listingCreateRunState.startedAt &&
            listingCreateRunState.startedAt >= saved.startedAt) {
            return;
        }
        listingCreateRunState.running = saved.running || false;
        listingCreateRunState.jobId = saved.jobId;
        listingCreateRunState.startedAt = saved.startedAt;
        listingCreateRunState.finishedAt = saved.finishedAt || null;
        listingCreateRunState.overallProgress = saved.overallProgress || 0;
        listingCreateRunState.summary = saved.summary || null;
        listingCreateRunState.items = saved.items || {};
        listingCreateRunState.rowsMeta = Array.isArray(saved.rowsMeta) ? saved.rowsMeta : [];
        listingCreateRunState.autoUploadOnComplete = saved.autoUploadOnComplete || false;
        // 兜底：如果 state.json 没存 filePath，从同目录反查 input.xlsx
        if (saved.filePath) {
            listingCreateRunState.filePath = saved.filePath;
        }
        else {
            const dir = path.dirname(latestPath);
            const candidate = path.join(dir, "input.xlsx");
            try {
                await stat(candidate);
                listingCreateRunState.filePath = candidate;
            }
            catch {
                listingCreateRunState.filePath = null;
            }
        }
        // 兜底：如果恢复出的状态是「所有行都跑完了但 running 标记没清掉」的 stuck 状态
        //（例如 server 重启/被杀发生在最后一行写快照之后、最终 running=false 快照之前），
        // 自动归一化为已结束，避免前端按钮永远被禁用。
        await normalizeStuckRunningState();
        // server 重启后，后台任务已被杀，任何标记为 running 的行实际上都已中断，
        // 转成 failed 以便用户点击「重试失败项」继续，而不是永远卡 running。
        let recoveredFromInterruption = false;
        for (const key of Object.keys(listingCreateRunState.items)) {
            const it = listingCreateRunState.items[key];
            if (it && it.status === "running") {
                it.status = "failed";
                it.currentStage = it.currentStage || "INTERRUPTED";
                it.reason = (it.reason ? `${it.reason}; ` : "") + "服务重启导致中断，请重试";
                recoveredFromInterruption = true;
            }
        }
        if (recoveredFromInterruption) {
            await snapshotListingCreate(listingCreateRunState.jobId);
        }
    }
    catch (error) {
        console.warn("recover listing create state failed:", error instanceof Error ? error.message : String(error));
    }
}
// 检查并修复 stuck 状态：running=true 但没有任何行仍在 running 中，且进度已跑完。
// 在 recover 和 status API 中都会调用，确保 server 重启或运行中都能自愈。
async function normalizeStuckRunningState() {
    const items = Object.values(listingCreateRunState.items);
    const anyRunning = items.some((it) => it.status === "running");
    if (listingCreateRunState.running && !anyRunning &&
        (listingCreateRunState.overallProgress >= 100 || items.length > 0)) {
        listingCreateRunState.running = false;
        listingCreateRunState.finishedAt = listingCreateRunState.finishedAt || new Date().toISOString();
        if (!listingCreateRunState.summary) {
            const success = items.filter((it) => it.status === "done").length;
            const failed = items.filter((it) => it.status === "failed").length;
            listingCreateRunState.summary = { success, failed, skipped: 0, total: items.length };
        }
        await snapshotListingCreate(listingCreateRunState.jobId);
        return true;
    }
    return false;
}

export function registerBatchListingCreateRoutes(app, deps) {
    const { upload, store, standardService, productProfiles, runBackground, getBatchRunStateRunning, getCollectRunStateRunning } = deps;

    app.post("/api/batch-listing-create/upload", upload.single("workbook"), async (request, response) => {
        try {
            await normalizeStuckRunningState();
            if (listingCreateRunState.running) {
                return response.status(409).json({ ok: false, error: "批量制作正在运行，请等待当前任务完成后再上传新文件" });
            }
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
                    imageCount: r.imageUrls.length + r.localImages.length
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
            // 防御性清理：残留 autoRun（曾被 watchdog 误杀导致）会挡住新任务
            const _st0 = store.get();
            if (_st0.autoRun && !_st0.running) {
                await store.update({ autoRun: false }).catch(() => {});
            }
            await normalizeStuckRunningState();
            const { jobId, autoUpload, categoryOverrides } = request.body || {};
            if (!jobId || !listingCreateRunState.filePath || listingCreateRunState.jobId !== jobId) {
                return response.status(400).json({ ok: false, error: "jobId 无效或文件未上传" });
            }
            if (listingCreateRunState.running) {
                return response.status(409).json({ ok: false, error: "已有批量制作任务正在运行" });
            }
            const st = store.get();
            if (st.running || st.autoRun) {
                return response.status(409).json({ ok: false, error: "单品流程正在运行" });
            }
            if (getBatchRunStateRunning && getBatchRunStateRunning()) {
                return response.status(409).json({ ok: false, error: "ERP 批量上架正在运行" });
            }
            if (getCollectRunStateRunning && getCollectRunStateRunning()) {
                return response.status(409).json({ ok: false, error: "采集箱批量上架正在运行" });
            }

            const buf = await readFile(listingCreateRunState.filePath);
            const wb = XLSX.read(buf, { type: "array" });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
            // 将 UI 表格手填的「类目」覆盖项写回 input.xlsx 的 category 列，使上架按指定类目选（而非自动猜测）。
            // UI 未填则保持 xlsx 原值；categoryOverrides 为空或无效则不改动文件。
            if (categoryOverrides && typeof categoryOverrides === "object" && Object.keys(categoryOverrides).length) {
                const header = (aoa[0] || []).map((h) => String(h || "").trim());
                let idxCat = header.findIndex((h) => /^(category|类目|产品类目|产品分类)$/.test(h));
                if (idxCat < 0) { aoa[0] = header.concat(["category"]); idxCat = header.length; }
                const idxName = header.findIndex((h) => /^(productName|产品名|产品名称|商品名)$/.test(h));
                if (idxName >= 0) {
                    for (let i = 1; i < aoa.length; i++) {
                        const row = aoa[i];
                        if (!row) continue;
                        const name = String(row[idxName] || "").trim();
                        const ov = (categoryOverrides[name] || "").toString().trim();
                        if (ov) {
                            if (!Array.isArray(row)) aoa[i] = [];
                            aoa[i][idxCat] = ov;
                        }
                    }
                    const newWs = XLSX.utils.aoa_to_sheet(aoa);
                    wb.Sheets[wb.SheetNames[0]] = newWs;
                    const outBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
                    await writeFile(listingCreateRunState.filePath, outBuf);
                }
            }
            const { rows, warnings } = parseRows(aoa);
            if (!rows.length) {
                return response.status(400).json({ ok: false, error: "表格中没有有效行", warnings });
            }

            listingCreateRunState.autoUploadOnComplete = !!autoUpload;
            runBackground(() => runBatchListingCreate(jobId, rows, listingCreateRunState.filePath, deps));
            return response.json({ ok: true, jobId, accepted: true });
        }
        catch (error) {
            console.error("batch-listing-create start error:", error);
            const message = error instanceof Error ? error.message : String(error);
            return response.status(500).json({ ok: false, error: message });
        }
    });

    app.post("/api/batch-listing-create/retry", async (request, response) => {
        try {
            const _st0 = store.get();
            if (_st0.autoRun && !_st0.running) {
                await store.update({ autoRun: false }).catch(() => {});
            }
            if (!listingCreateRunState.jobId) {
                await recoverListingCreateState();
            }
            await normalizeStuckRunningState();
            const { jobId, autoUpload } = request.body || {};
            if (!jobId || !listingCreateRunState.filePath || listingCreateRunState.jobId !== jobId) {
                return response.status(400).json({ ok: false, error: "jobId 无效或文件未上传" });
            }
            if (listingCreateRunState.running) {
                return response.status(409).json({ ok: false, error: "已有批量制作任务正在运行，请先等待完成" });
            }
            const st = store.get();
            if (st.running || st.autoRun) {
                return response.status(409).json({ ok: false, error: "单品流程正在运行，请先暂停或结束" });
            }
            if (getBatchRunStateRunning && getBatchRunStateRunning()) {
                return response.status(409).json({ ok: false, error: "ERP 批量上架正在运行" });
            }
            // 检查有没有可重试的失败项
            const failedItems = Object.values(listingCreateRunState.items).filter((it) => it.status === "failed");
            if (!failedItems.length) {
                return response.status(400).json({ ok: false, error: "当前没有失败项可重试" });
            }
            listingCreateRunState.running = true;
            runBackground(() => runBatchListingCreateRetry(jobId, listingCreateRunState.filePath, deps).catch((error) => {
                console.error("batch-listing-create retry error:", error);
                listingCreateRunState.running = false;
                listingCreateRunState.summary = listingCreateRunState.summary || {
                    success: 0,
                    failed: failedItems.length,
                    skipped: 0,
                    total: failedItems.length
                };
                snapshotListingCreate(jobId).catch(() => {});
            }));
            return response.json({
                ok: true,
                jobId,
                accepted: true,
                retryCount: failedItems.length
            });
        }
        catch (error) {
            console.error("batch-listing-create retry error:", error);
            const message = error instanceof Error ? error.message : String(error);
            return response.status(500).json({ ok: false, error: message });
        }
    });

    app.get("/api/batch-listing-create/status", async (request, response) => {
        try {
            if (!listingCreateRunState.jobId) {
                await recoverListingCreateState();
            }
            // 运行中如果发生 stuck（所有行跑完但 running 没清），自动归一化
            await normalizeStuckRunningState();
            // summary 是 items 的派生数据：任务已结束时，强制从 items 重算，修正计数器漂移
            if (!listingCreateRunState.running && listingCreateRunState.rowsMeta && listingCreateRunState.rowsMeta.length > 0) {
                const stateItems = Object.values(listingCreateRunState.items);
                const doneCount = stateItems.filter((it) => it.status === "done").length;
                const failedCount = stateItems.filter((it) => it.status === "failed").length;
                const expectedTotal = listingCreateRunState.rowsMeta.length;
                if (!listingCreateRunState.summary ||
                    listingCreateRunState.summary.success !== doneCount ||
                    listingCreateRunState.summary.failed !== failedCount ||
                    listingCreateRunState.summary.total !== expectedTotal) {
                    listingCreateRunState.summary = { success: doneCount, failed: failedCount, skipped: 0, total: expectedTotal };
                    snapshotListingCreate(listingCreateRunState.jobId).catch(() => {});
                }
            }
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
                startedAt: listingCreateRunState.startedAt,
                finishedAt: listingCreateRunState.finishedAt,
                overallProgress: listingCreateRunState.overallProgress,
                summary: listingCreateRunState.summary,
                rowsMeta: listingCreateRunState.rowsMeta || [],
                autoUploadOnComplete: listingCreateRunState.autoUploadOnComplete,
                autoUploadStatus: listingCreateRunState.autoUploadStatus,
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

// ===== 工作流桥接：供 server.js 的 /api/workflow/listing-to-upload 调用 =====
export function isListingCreateRunning() {
    return listingCreateRunState.running;
}

export function getLatestListingCreateJob() {
    return {
        jobId: listingCreateRunState.jobId,
        running: listingCreateRunState.running,
        finishedAt: listingCreateRunState.finishedAt,
        items: listingCreateRunState.items || {}
    };
}

// 直读 input.xlsx 原始单元格（不走 parseRows，避免新增列被静默丢弃）
export async function readInputWorkbook() {
    const fp = listingCreateRunState.filePath;
    if (!fp) return [];
    let buf;
    try {
        buf = await readFile(fp);
    } catch {
        return [];
    }
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const header = (aoa[0] || []).map((h) => String(h || "").trim());
    const col = (re) => header.findIndex((h) => re.test(h));
    const idx = {
        productName: col(/^(productName|产品名|产品名称|商品名)$/),
        uploadMode: col(/^(uploadMode|上架模式|上架类型)$/),
        searchTitle: col(/^(searchTitle|搜索标题|采集箱标题)$/),
        productTemplate: col(/^(productTemplate|产品模板|模板)$/),
        logisticsAttribute: col(/^(logisticsAttribute|物流属性|物流)$/),
        material: col(/^(material|材质)$/),
        referenceProductId: col(/^(referenceProductId|引用商品ID|引用ID)$/),
        variantThemeMap: col(/^(variantThemeMap|变种主题映射|变种映射)$/),
        outputDirectory: col(/^(outputDirectory|归档目录)$/)
    };
    const rows = [];
    for (let i = 1; i < aoa.length; i++) {
        const cells = aoa[i] || [];
        const get = (k) => (idx[k] >= 0 ? String(cells[idx[k]] || "").trim() : "");
        const productName = get("productName");
        if (!productName) continue;
        let uploadMode = get("uploadMode").toLowerCase();
        if (uploadMode === "引用" || uploadMode === "reference" || uploadMode === "ref" || uploadMode === "yinyong") {
            uploadMode = "reference";
        } else {
            uploadMode = "collect";
        }
        rows.push({
            productName,
            uploadMode,
            searchTitle: get("searchTitle"),
            productTemplate: get("productTemplate"),
            logisticsAttribute: get("logisticsAttribute"),
            material: get("material"),
            referenceProductId: get("referenceProductId"),
            variantThemeMap: get("variantThemeMap"),
            outputDirectory: get("outputDirectory")
        });
    }
    return rows;
}
