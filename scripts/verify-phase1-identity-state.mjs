/**
 * 阶段 1 验收测试（YKB-V1-PHASE1-IDENTITY-STATE-20261030-R1 / J. 必须新增的自动化测试）
 *
 * 14 条断言逐条对应实施指令 J。全部在**临时目录**内跑，不触碰生产数据：
 *   - identity / template-snapshot / selection-board 都用 mkdtemp 出来的隔离 dataDir；
 *   - 只有「474 分层不变」这一项读真实文件，且是只读校验；
 *   - 需要 HTTP 的图片直链测试用本机临时 server 提供，不出网。
 *
 * 运行：node scripts/verify-phase1-identity-state.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir, copyFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProductIdentityService, MAPPING_STATUS, STORE_VERIFICATION } from "../dist/src/product-identity-service.js";
import { ListingTemplateSnapshotService, PLATFORM_VERSION_UNAVAILABLE, SNAPSHOT_STATUS } from "../dist/src/listing-template-snapshot-service.js";
import { SelectionBoardService } from "../dist/src/selection-board-service.js";
import { auditImageIsolation } from "../dist/src/image-isolation-guard.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/* ── 474 件分层的改造前基线（2026-10-30 阶段1开始前实测）──
   任何一项变了，说明历史分层被改写，必须立刻停止并回滚。
   注：layerAssignFingerprint 用 `itemId|layer|sub` 逐行拼接（null 归一为空串），
   不使用 JSON 序列化，避免跨语言浮点/转义差异造成假报警。 */
const STRATA_FILE = path.join(ROOT, "data/metrics/strata/2026-10-25.json");
const STRATA_BASELINE = {
    fileSha256: "d982c5c42264fa7f2c1cc8de31df47c06a96a34306505936166fd5a3faf8bae0",
    totalItems: 474,
    records: 474,
    layerDist: { A: 19, B: 10, C1: 174, C2: 199, M: 59, N: 9, S: 4 },
    layerAssignFingerprint: "a76a6476a26c8848b9e6cfebb1921db71934b2394c56e783c1fc8c99c12a1d76"
};

const results = [];
function record(id, name, ok, detail) {
    results.push({ id, name, ok, detail });
    const mark = ok ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${id}. ${name}${detail ? ` — ${detail}` : ""}`);
}
async function test(id, name, fn) {
    try {
        const detail = await fn();
        record(id, name, true, detail);
    } catch (error) {
        record(id, name, false, error instanceof Error ? error.message : String(error));
    }
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ykb-phase1-"));

/* 本机图片服务：让「图片直链导入」测试离线可跑，且能断言 URL 原样保存 */
const imageServer = http.createServer(async (request, response) => {
    if (request.url?.startsWith("/img/product-sample.jpg")) {
        const buffer = await readFile(path.join(ROOT, "_input_20261026/bagcharm-01.jpg"));
        response.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": buffer.length });
        response.end(buffer);
        return;
    }
    response.writeHead(404);
    response.end("not found");
});
await new Promise((resolve) => imageServer.listen(0, "127.0.0.1", resolve));
const imagePort = imageServer.address().port;

console.log("\n=== 阶段1 验收测试 ===\n");
console.log(`临时目录: ${tempRoot}\n`);

/* ══ 1. 新产品创建生成 UUID ══ */
const identity = new ProductIdentityService({ dataDir: path.join(tempRoot, "identity") });
await identity.load();
let createdProductId = null;

await test("01", "新产品创建生成 UUID", async () => {
    const created = await identity.registerProduct({
        productName: "测试·帆布笔袋",
        sourceSystem: "selection-board",
        sourceRecordType: "board-item",
        sourceRecordId: "sb_test_001"
    });
    createdProductId = created.product_id;
    assert.ok(created.created, "应标记为新建");
    assert.match(created.product_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "product_id 必须是 UUID");
    assert.notEqual(created.product_id, "400370", "UUID 不得等于外部店铺编号");
    return created.product_id;
});

/* ══ 2. 同一来源记录重复导入返回相同 Product UUID ══ */
await test("02", "同源记录重复导入幂等（同 UUID，不新建）", async () => {
    const replay = await identity.registerProduct({
        productName: "测试·帆布笔袋（改了名字）",
        sourceSystem: "selection-board",
        sourceRecordType: "board-item",
        sourceRecordId: "sb_test_001"
    });
    assert.equal(replay.product_id, createdProductId, "同源同类型同 ID 必须返回同一 product_id");
    assert.equal(replay.created, false, "重复导入不应新建产品");
    assert.equal(replay.idempotentReplay, true, "应标记幂等重放");
    assert.equal(identity.listProducts().length, 1, "产品表里应仍只有 1 条");
    return `复用 ${replay.product_id}`;
});

/* ══ 3. 不同来源记录不会仅因同名被自动合并 ══ */
await test("03", "不同来源同名记录不自动合并", async () => {
    const other = await identity.registerProduct({
        productName: "测试·帆布笔袋", // 完全同名
        sourceSystem: "product-profile",
        sourceRecordType: "product-profile",
        // 用测试专用假 ID：绝不能拿真实 149 份档案里的 ID 做试验，
        // 否则会污染第 4 条「历史记录全部 NEEDS_REVIEW」的断言
        sourceRecordId: "test-only-profile-id-0001"
    });
    assert.notEqual(other.product_id, createdProductId, "同名不同来源绝不能自动合并成同一 UUID");
    assert.equal(other.created, true);
    assert.equal(identity.listProducts().length, 2, "应存在 2 个独立产品");
    return "同名但保持独立身份";
});

/* ══ 4. 149 + 2 历史 ID 零交集时映射结果可追溯 ══ */
await test("04", "历史 ID 零交集 → crosswalk dry-run 可追溯且不写库", async () => {
    const { readdir } = await import("node:fs/promises");
    const completedDir = path.join(ROOT, "已完成产品");
    const dirs = await readdir(completedDir, { withFileTypes: true });
    const profiles = [];
    for (const entry of dirs) {
        if (!entry.isDirectory()) continue;
        try {
            const raw = await readFile(path.join(completedDir, entry.name, "product-profile.json"), "utf8");
            const parsed = JSON.parse(raw);
            if (parsed?.productId) profiles.push({ id: parsed.productId, dir: entry.name, name: parsed?.identity?.displayName || entry.name });
        } catch {
            /* 该目录没有 product-profile.json，跳过 */
        }
    }
    const cards = JSON.parse(await readFile(path.join(ROOT, "listing-cards.json"), "utf8"));
    const cardIds = [...new Set(cards.map((card) => card.product_id).filter(Boolean))];

    // 零交集校验（审查报告的核心实测事实，必须仍然成立）
    const overlap = profiles.filter((entry) => cardIds.includes(entry.id));
    assert.equal(overlap.length, 0, `product-profile 与 listing-card 的 product_id 必须零交集，实际重叠 ${overlap.length} 条`);

    /* 口径核对：151 个目录 / 149 个唯一 productId。
       存在 2 组「同一 productId 被两个目录共用」（归档时目录已存在加 (2) 后缀，
       productId 沿用旧值）。这属于身份歧义，**不自动合并**，
       故 source_record_id 用目录名（文件系统唯一）而不是 productId。 */
    const byProductId = new Map();
    for (const entry of profiles) {
        if (!byProductId.has(entry.id)) byProductId.set(entry.id, []);
        byProductId.get(entry.id).push(entry.dir);
    }
    const duplicated = [...byProductId.entries()].filter(([, list]) => list.length > 1);

    const records = [
        ...profiles.map((entry) => ({
            sourceSystem: "product-profile",
            sourceRecordType: "product-profile",
            // ★ 完整相对路径（含来源根），跨根唯一
            sourceRecordId: `已完成产品/${entry.dir}`,
            productName: entry.name
        })),
        ...cards
            .filter((card) => card.product_id)
            .map((card) => ({
                sourceSystem: "listing-cards",
                sourceRecordType: "listing-card",
                sourceRecordId: card.product_id,
                productName: card.listing_title || ""
            }))
    ];

    const before = identity.listMappings().length;
    const dryRun = identity.buildCrosswalkDryRun(records);
    const after = identity.listMappings().length;

    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.wroteAnything, false, "dry-run 绝不能写库");
    assert.equal(before, after, "dry-run 前后映射数必须不变");
    assert.equal(dryRun.totalRecords, records.length);
    assert.equal(dryRun.alreadyMapped, 0, "历史来源记录此时不应有任何已映射");
    assert.equal(dryRun.needsReview, records.length, "全部应待人工核验");
    assert.ok(dryRun.rows.every((row) => row.resolution === "NEEDS_REVIEW"));

    assert.equal(profiles.length, 151, "已完成产品目录下应有 151 份 product-profile.json");
    assert.equal(byProductId.size, 149, "唯一 productId 应为 149 个");
    assert.equal(duplicated.length, 2, "应检出 2 组 productId 被多目录共用（须人工核验，不得自动合并）");

    /* 映射键完整性（最终验收任务 3）：
       - 键 = source_system + source_record_type + 完整相对路径；
       - 重复组两条来源记录 → 两个独立规范 UUID，绝不合并；
       - 原始 productId 作为 legacy_product_id 保留。 */
    const keyService = new ProductIdentityService({ dataDir: path.join(tempRoot, "key-audit") });
    await keyService.load();
    const [dupProductId, dupDirs] = duplicated[0];
    for (const dir of dupDirs) {
        await keyService.registerProduct({
            productName: dir,
            sourceSystem: "product-profile",
            sourceRecordType: "product-profile",
            sourceRecordId: `已完成产品/${dir}`,
            legacyProductId: dupProductId
        });
    }
    const keyAudit = keyService.auditMappingKeys();
    assert.equal(keyAudit.duplicateKeys.length, 0, "映射键不得冲突");
    assert.equal(keyAudit.nonPathLikeSourceIds.length, 0, "product-profile 的 source_record_id 必须是完整相对路径");
    assert.equal(keyAudit.mappingsMissingLegacyProductId.length, 0, "原始 productId 必须作为 legacy_product_id 保留");
    assert.equal(keyService.listProducts().length, 2, "重复组必须产生 2 个独立 UUID（不自动合并）");
    assert.ok(
        keyService.listMappings().every((mapping) => mapping.legacy_product_id === dupProductId),
        "两条映射都要保留原始 productId"
    );
    assert.ok(
        keyService.listMappings().every((mapping) => String(mapping.source_record_id).startsWith("已完成产品/")),
        "来源记录键必须是完整相对路径"
    );

    return `151 份档案 / 149 唯一 ID（2 组重复）+ 3 张卡；映射键 0 冲突、legacy ID 全保留、重复组不合并`;
});

/* ══ 5. 400370 仅作外部编号字符串 ══ */
await test("05", "400370 登记为待核验店铺，内部 UUID ≠ 400370，发布权限 false", async () => {
    const registered = await identity.registerStore({
        storeName: "纳物-箱包全托1店",
        externalStoreCode: "400370",
        externalIdNamespace: "UNKNOWN_PENDING_VERIFICATION",
        source: "MANUAL_REGISTRATION_PHASE1"
    });
    assert.equal(registered.created, true);
    const store = registered.store;
    assert.equal(store.external_store_code, "400370");
    assert.equal(typeof store.external_store_code, "string", "外部编号必须是字符串");
    assert.match(store.store_id, /^[0-9a-f-]{36}$/, "内部 store_id 必须是 UUID");
    assert.notEqual(store.store_id, "400370");
    assert.equal(store.verification_status, STORE_VERIFICATION.PENDING_VERIFICATION);
    assert.equal(store.publishing_allowed, false);

    const gate = identity.canPublishToStore(store.store_id);
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, "STORE_PENDING_VERIFICATION");

    // 重复登记幂等
    const again = await identity.registerStore({ storeName: "纳物-箱包全托1店", externalStoreCode: "400370" });
    assert.equal(again.created, false);
    assert.equal(again.store.store_id, store.store_id);
    assert.equal(identity.listStores().length, 1);
    return `store_id=${store.store_id.slice(0, 8)}… external=400370 publishing_allowed=false`;
});

/* ══ 三套状态：准备一个临时看板 ══ */
const boardDir = path.join(tempRoot, "board");
const board = new SelectionBoardService({
    boardDir,
    boardFile: path.join(boardDir, "board.json"),
    imagesDir: path.join(boardDir, "images"),
    styleDir: path.join(boardDir, "style-refs")
});
await board.load();
const boardItem = (await board.createItem({
    name: "测试候选·状态拆分",
    objectiveInfo: "规格：20 × 10 × 6 cm"
})).item;
const secondBoardItem = (await board.createItem({ name: "测试候选·双店铺" })).item;

/* ══ 6. 三套状态互不覆盖 ══ */
await test("06", "三套状态互不覆盖（开发 / 同步 / 逐店）", async () => {
    // 6a. 改开发阶段不动同步状态
    await board.updateItem(boardItem.id, { dianxiaomiSyncStatus: "SYNCED" });
    await board.updateItem(boardItem.id, { developmentStage: "LISTING_IN_PROGRESS" });
    let current = board.findItem(boardItem.id);
    assert.equal(current.developmentStage, "LISTING_IN_PROGRESS");
    assert.equal(current.dianxiaomiSyncStatus, "SYNCED", "改开发阶段不得重置同步状态");

    // 6b. 改同步状态不动开发阶段
    await board.updateItem(boardItem.id, { dianxiaomiSyncStatus: "SYNC_FAILED" });
    current = board.findItem(boardItem.id);
    assert.equal(current.developmentStage, "LISTING_IN_PROGRESS", "改同步状态不得重置开发阶段");
    assert.equal(current.dianxiaomiSyncStatus, "SYNC_FAILED");

    // 6c. 逐店刊登只写指定店铺
    await board.upsertStoreListing(boardItem.id, { storeId: "store-a", status: "PUBLISHED" });
    await board.upsertStoreListing(boardItem.id, { storeId: "store-b", status: "PLANNED" });
    current = board.findItem(boardItem.id);
    assert.equal(current.storeListings.length, 2);
    assert.equal(current.developmentStage, "LISTING_IN_PROGRESS", "写逐店状态不得影响开发阶段");
    assert.equal(current.dianxiaomiSyncStatus, "SYNC_FAILED", "写逐店状态不得影响同步状态");
    return "三通道各自独立写入，互不重置";
});

/* ══ 7. SYNCED 不会把店铺标成 PUBLISHED ══ */
await test("07", "店小秘 SYNCED 不会把任何店铺变成 PUBLISHED", async () => {
    const fresh = (await board.createItem({ name: "测试候选·同步不改店铺" })).item;
    await board.upsertStoreListing(fresh.id, { storeId: "store-c", status: "CONTENT_PREPARING" });
    await board.updateItem(fresh.id, { dianxiaomiSyncStatus: "SYNCED" });
    const current = board.findItem(fresh.id);
    assert.equal(current.dianxiaomiSyncStatus, "SYNCED");
    assert.equal(current.storeListings.length, 1);
    assert.equal(current.storeListings[0].status, "CONTENT_PREPARING", "同步成功绝不能推进店铺刊登状态");
    assert.ok(
        current.storeListings.every((entry) => entry.status !== "PUBLISHED"),
        "任何店铺都不能因同步成功被标记 PUBLISHED"
    );
    return "sync=SYNCED，店铺仍为 CONTENT_PREPARING";
});

/* ══ 8. 店铺 A 失败不影响店铺 B ══ */
await test("08", "店铺 A 发布失败不影响店铺 B 状态", async () => {
    await board.upsertStoreListing(secondBoardItem.id, { storeId: "store-x", status: "SUBMITTING" });
    await board.upsertStoreListing(secondBoardItem.id, { storeId: "store-y", status: "SUBMITTING" });
    await board.upsertStoreListing(secondBoardItem.id, { storeId: "store-x", status: "FAILED", failureReason: "平台校验失败" });
    const current = board.findItem(secondBoardItem.id);
    const storeX = current.storeListings.find((entry) => entry.storeId === "store-x");
    const storeY = current.storeListings.find((entry) => entry.storeId === "store-y");
    assert.equal(storeX.status, "FAILED");
    assert.equal(storeX.failureReason, "平台校验失败");
    assert.equal(storeY.status, "SUBMITTING", "店铺 B 不得被店铺 A 的失败覆盖");
    return "store-x=FAILED，store-y=SUBMITTING（未被污染）";
});

/* ══ 9. images[].sourceUrl 全链路一致 ══ */
await test("09", "images[].sourceUrl 从输入→持久化→重读保持一致", async () => {
    /* 生产环境的 downloadPublicImage 会拒绝私网地址（SSRF 防护），本机测试服务器
       必然被拦，所以这里注入 stub 验证「URL 保存链路」，
       另起一个不做注入的实例验证「私网防护没被改坏」。 */
    const urlDir = path.join(tempRoot, "board-url");
    const url = "https://cbu01.alicdn.com/img/ibank/O1CN01EXAMPLE_!!0-item_pic.jpg";
    const imageBuffer = await readFile(path.join(ROOT, "_input_20261026/bagcharm-01.jpg"));
    let receivedUrl = null;

    const stubBoard = new SelectionBoardService({
        boardDir: urlDir,
        boardFile: path.join(urlDir, "board.json"),
        imagesDir: path.join(urlDir, "images"),
        styleDir: path.join(urlDir, "style-refs"),
        downloadImage: async (requestedUrl) => {
            receivedUrl = requestedUrl;
            return imageBuffer;
        }
    });
    await stubBoard.load();
    const target = (await stubBoard.createItem({ name: "测试候选·图片直链" })).item;
    const added = await stubBoard.addImageUrls(target.id, [url]);

    assert.equal(receivedUrl, url, "下载器收到的 URL 必须与用户输入一字不差");
    assert.equal(added.result.imported.length, 1, "应导入 1 张");
    assert.equal(added.item.images[0].sourceUrl, url, "内存中的 sourceUrl 必须等于原始 URL");
    assert.equal(added.item.images[0].sourceUrlStatus, "RECORDED");
    assert.equal(added.item.images[0].assetType, "MAIN", "第一张图自动成为主图");

    // 重新从磁盘加载，验证持久化往返
    const reloaded = new SelectionBoardService({
        boardDir: urlDir,
        boardFile: path.join(urlDir, "board.json"),
        imagesDir: path.join(urlDir, "images"),
        styleDir: path.join(urlDir, "style-refs")
    });
    await reloaded.load();
    const persisted = reloaded.findItem(target.id);
    assert.equal(persisted.images[0].sourceUrl, url, "重读后 sourceUrl 必须一字不差");
    assert.equal(persisted.images[0].assetType, "MAIN");
    assert.equal(persisted.images[0].sourceUrlStatus, "RECORDED");

    // 第二张应为 ADDITIONAL（主图固定 1 张）
    await stubBoard.addImageUrls(target.id, ["https://cbu01.alicdn.com/img/ibank/O1CN02EXAMPLE.jpg"]);
    assert.equal(stubBoard.findItem(target.id).images[1].assetType, "ADDITIONAL");

    // 私网地址必须仍被真实下载器拒绝（SSRF 防护未被削弱）
    const guardedDir = path.join(tempRoot, "board-guarded");
    const guarded = new SelectionBoardService({
        boardDir: guardedDir,
        boardFile: path.join(guardedDir, "board.json"),
        imagesDir: path.join(guardedDir, "images"),
        styleDir: path.join(guardedDir, "style-refs")
    });
    await guarded.load();
    const guardedItem = (await guarded.createItem({ name: "测试候选·私网拦截" })).item;
    const blocked = await guarded.addImageUrls(guardedItem.id, [`http://127.0.0.1:${imagePort}/img/product-sample.jpg`]);
    assert.equal(blocked.result.imported.length, 0, "私网图片必须被拒绝");
    assert.equal(blocked.result.failed.length, 1);
    assert.match(String(blocked.result.failed[0].reason), /私有|内网|private|localhost|拒绝|不允许/i);

    return `sourceUrl 往返一致；主图/附图分类正确；私网仍被拒`;
});

/* ══ 10. STYLE_REFERENCE 不会被产品事实图扫描读取 ══ */
await test("10", "风格参考图与产品事实图隔离（内容哈希级守卫）", async () => {
    const productDir = path.join(tempRoot, "iso/product");
    const styleDir = path.join(tempRoot, "iso/style");
    await mkdir(productDir, { recursive: true });
    await mkdir(styleDir, { recursive: true });

    const sample = path.join(ROOT, "_input_20261026/bagcharm-01.jpg");
    await copyFile(sample, path.join(productDir, "fact-01.jpg"));
    await copyFile(sample, path.join(styleDir, "style-01.jpg"));

    const dirty = await auditImageIsolation({ productImagesDir: productDir, styleReferenceDir: styleDir });
    assert.equal(dirty.ok, false, "同一份字节同时存在于两边时必须报错");
    assert.equal(dirty.overlappingHashes.length, 1);

    // 换成不同内容后应通过
    await writeFile(path.join(styleDir, "style-01.jpg"), Buffer.from("not-an-image-but-different"));
    const clean = await auditImageIsolation({ productImagesDir: productDir, styleReferenceDir: styleDir });
    assert.equal(clean.ok, true, "内容不重叠时应通过");
    return "重叠时 ok=false（P0），隔离时 ok=true";
});

/* ══ 11. 本地模板快照可追溯，不伪造平台版本 ══ */
await test("11", "模板本地快照有 hash/时间/状态，且拒绝伪造平台版本号", async () => {
    const snapshots = new ListingTemplateSnapshotService({ dataDir: path.join(tempRoot, "identity") });
    await snapshots.load();

    const captured = await snapshots.capture({
        templateRef: "箱包配件-Choice半托管模板",
        templateName: "箱包配件-Choice半托管模板",
        content: "标题规则: 品牌+材质+用途\n图片规则: 白底主图 + 场景图x3",
        captureMethod: "MANUAL_INPUT",
        productId: createdProductId
    });
    const snapshot = captured.snapshot;
    assert.match(snapshot.content_hash, /^[0-9a-f]{64}$/, "必须有 sha256");
    assert.ok(snapshot.captured_at, "必须有捕获时间");
    assert.equal(snapshot.snapshot_status, SNAPSHOT_STATUS.CAPTURED);
    assert.equal(snapshot.platform_template_version, PLATFORM_VERSION_UNAVAILABLE, "平台版本必须明确为不可得");
    assert.match(snapshot.local_snapshot_version, /^LOCAL-/, "本地版本号必须有独立前缀");

    // 拒绝伪造平台版本
    let rejected = false;
    try {
        await snapshots.capture({ templateRef: "x", content: "y", platformTemplateVersion: "v2.3" });
    } catch (error) {
        rejected = /拒绝写入平台模板版本号/.test(String(error.message));
    }
    assert.ok(rejected, "传入具体平台版本号必须被拒绝");

    // 无可读内容 → MANUAL_CAPTURE_REQUIRED
    const manual = await snapshots.capture({ templateRef: "无内容模板" });
    assert.equal(manual.snapshot.snapshot_status, SNAPSHOT_STATUS.MANUAL_CAPTURE_REQUIRED);

    // requireUsableSnapshot 对缺失模板返回 BLOCKED_TEMPLATE
    const gate = snapshots.requireUsableSnapshot("不存在的模板");
    assert.equal(gate.ok, false);
    assert.equal(gate.blocked, "BLOCKED_TEMPLATE");
    return `snapshot=${snapshot.local_snapshot_version} hash=${snapshot.content_hash.slice(0, 12)}… platform=${PLATFORM_VERSION_UNAVAILABLE}`;
});

/* ══ 12. 474 件分层原值与记录数不变 ══ */
await test("12", "474 件关注分层：文件哈希 / 记录数 / 层分布 / 字段指纹全部不变", async () => {
    const buffer = await readFile(STRATA_FILE);
    const fileHash = sha256(buffer);
    assert.equal(fileHash, STRATA_BASELINE.fileSha256, "分层结果文件哈希必须完全一致（字节级）");

    const parsed = JSON.parse(buffer.toString("utf8"));
    assert.equal(parsed.totalItems, STRATA_BASELINE.totalItems);
    assert.equal(parsed.items.length, STRATA_BASELINE.records);

    const dist = {};
    for (const item of parsed.items) dist[item.layer] = (dist[item.layer] ?? 0) + 1;
    assert.deepEqual(dist, STRATA_BASELINE.layerDist, "层分布必须完全一致");

    // 层归属指纹：itemId|layer|sub 逐行拼接（null 归一为空串），跨语言一致
    const lines = parsed.items.map(
        (item) => `${item.itemId || ""}|${item.layer || ""}|${item.sub || ""}`
    );
    const assignFingerprint = sha256(Buffer.from(lines.join("\n"), "utf8"));
    assert.equal(
        assignFingerprint,
        STRATA_BASELINE.layerAssignFingerprint,
        "474 条记录的「层归属」必须逐条一致（任何一件商品被改层都会变）"
    );
    return `${parsed.items.length} 条，S4/A19/B10/M59/N9/C1:174/C2:199，文件哈希与层归属指纹双重一致`;
});

/* ══ 13. 重试与重复触发不产生重复记录 ══ */
await test("13", "重复触发不产生重复记录（产品 / 映射 / 店铺 / 推送幂等键）", async () => {
    const productsBefore = identity.listProducts().length;
    const mappingsBefore = identity.listMappings().length;
    for (let index = 0; index < 3; index += 1) {
        await identity.registerProduct({
            productName: "重复注册测试",
            sourceSystem: "selection-board",
            sourceRecordType: "board-item",
            sourceRecordId: "sb_idem_999"
        });
    }
    assert.equal(identity.listProducts().length, productsBefore + 1, "三次重复注册只能新增 1 个产品");
    assert.equal(identity.listMappings().length, mappingsBefore + 1, "三次重复注册只能新增 1 条映射");

    // 同一 item 连续两次计算幂等键必须一致（推送去重依据）
    const item = board.findItem(boardItem.id);
    const key1 = board.pushIdempotencyKey(item);
    const key2 = board.pushIdempotencyKey(board.findItem(boardItem.id));
    assert.equal(key1, key2, "同一素材状态下的推送幂等键必须稳定");
    assert.match(key1, /^[0-9a-f]{24}$/);
    return `产品 +1、映射 +1、幂等键稳定 ${key1.slice(0, 12)}…`;
});

/* ══ 14. 旧功能回归 ══ */
await test("14", "旧功能回归：服务入口与既有状态映射仍可用", async () => {
    const serverSource = await readFile(path.join(ROOT, "dist/src/server.js"), "utf8");
    const requiredRoutes = [
        "/api/selection-board",
        "/api/selection-board/items",
        "/api/selection-board/statuses",
        "/api/identity/products",
        "/api/identity/mappings",
        "/api/identity/stores",
        "/api/identity/template-snapshots",
        "/api/import-images",
        "/api/style-ref-images",
        "/api/dianxiaomi/upload-images",
        "/api/queue/template"
    ];
    const missing = requiredRoutes.filter((route) => !serverSource.includes(`"${route}`));
    assert.deepEqual(missing, [], `缺失路由: ${missing.join(", ")}`);

    // 旧七态映射表必须完整（旧客户端读 status 仍能拿到值）
    const { LEGACY_STATUS_TO_STATE } = await import("../dist/src/selection-board-service.js");
    const legacyKeys = Object.keys(LEGACY_STATUS_TO_STATE).sort();
    assert.deepEqual(legacyKeys, ["DROPPED", "LISTING", "LISTING_DONE", "ON_HOLD", "PICKED", "READY", "SAVED_DXM"]);

    // 旧 status 写入仍会落到新字段（兼容读取）
    const compat = (await board.createItem({ name: "测试候选·旧接口兼容", status: "SAVED_DXM" })).item;
    assert.equal(compat.developmentStage, "LISTING_READY");
    assert.equal(compat.dianxiaomiSyncStatus, "SYNCED");
    return `${requiredRoutes.length} 条路由齐全，旧七态映射完整，旧 status 写入可映射`;
});

/* ── 收尾 ── */
imageServer.close();
await rm(tempRoot, { recursive: true, force: true });

const passed = results.filter((entry) => entry.ok).length;
const failed = results.filter((entry) => !entry.ok);
console.log(`\n=== 结果: ${passed}/${results.length} 通过 ===`);
if (failed.length) {
    console.log("\n失败项:");
    for (const entry of failed) console.log(`  x ${entry.id}. ${entry.name} — ${entry.detail}`);
    process.exit(1);
}
console.log("全部通过。\n");
