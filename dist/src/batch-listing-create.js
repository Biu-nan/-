import * as XLSX from "xlsx";
import path from "node:path";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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

const listingCreateRunState = {
    running: false,
    jobId: null,
    startedAt: null,
    finishedAt: null,
    overallProgress: 0,
    summary: null,
    items: {},
    rowsMeta: [],
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
        rowsMeta: listingCreateRunState.rowsMeta || []
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
    let success = 0;
    let failed = 0;
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
        if (!listingCreateRunState.summary) {
            listingCreateRunState.summary = { success, failed, skipped: 0, total: rows.length };
        }
        try {
            await snapshotListingCreate(jobId);
        }
        catch {}
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

    // 找出当前 failed 项对应的原行号；done 项不重跑
    const failedIndices = Object.entries(listingCreateRunState.items)
        .filter(([, it]) => it.status === "failed")
        .map(([k]) => Number(k))
        .filter((n) => Number.isFinite(n) && n >= 0)
        .sort((a, b) => a - b);
    if (!failedIndices.length) {
        throw new Error("当前没有失败项可重试");
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

    const resultsByIndex = {};
    let success = 0;
    let failed = 0;
    let processed = 0;

    for (const i of failedIndices) {
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
            await rm(OUTPUT_DIR, { recursive: true, force: true });
            await mkdir(OUTPUT_DIR, { recursive: true });
            await rm(PRODUCT_PROFILE_FILE, { force: true });

            const objectiveParts = [`产品名：${row.productName}`];
            if (row.category) objectiveParts.push(`类目：${row.category}`);
            if (row.notes) objectiveParts.push(`补充信息：${row.notes}`);
            await store.update({
                workflowMode: "standard_listing",
                standardWorkflowGoal: row.mode,
                provider: "chatgpt",
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
        listingCreateRunState.overallProgress = Math.round(((rows.length - failedIndices.length + processed) / rows.length) * 100);
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
    listingCreateRunState.summary = listingCreateRunState.summary || { success, failed, skipped: 0, total: rows.length };
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

async function recoverListingCreateState() {
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
    const { upload, store, standardService, productProfiles, runBackground, getBatchRunStateRunning } = deps;

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
            const { jobId } = request.body || {};
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
            const { jobId } = request.body || {};
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
                rowsMeta: listingCreateRunState.rowsMeta || [],
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
