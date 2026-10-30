/**
 * 产品身份映射审计（阶段 1 最终验收 · 任务 3）
 *
 * 只读。回答六个问题：
 *   1. 两个重复 productId 组具体是哪些目录？
 *   2. 每个目录能否成为**独立来源记录**（完整相对路径唯一）？
 *   3. 映射键是否 = source_system + source_record_type + 完整相对路径？
 *   4. 原始 productId 是否作为历史字段保留（legacy_product_id）？
 *   5. 是否存在「仅因同名/同图」被自动合并的风险？
 *   6. 无法核验的记录是否会被自动合并（应恒为「不会」）？
 *
 * 运行：node scripts/audit-product-identity.mjs
 * 输出：控制台摘要 + _verify/identity-audit.json
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProductIdentityService, sourceKey, normalizeSourcePath } from "../dist/src/product-identity-service.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOTS = ["已完成产品", "当前产品", "已遗弃产品"];

/** 扫描所有来源根下的 product-profile.json */
async function scanProfiles() {
    const records = [];
    for (const rootName of SOURCE_ROOTS) {
        const rootDir = path.join(ROOT, rootName);
        let entries = [];
        try {
            entries = await readdir(rootDir, { withFileTypes: true });
        } catch {
            continue; // 该来源根不存在
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const profilePath = path.join(rootDir, entry.name, "product-profile.json");
            let raw;
            try {
                raw = await readFile(profilePath, "utf8");
            } catch {
                continue; // 无 product-profile.json
            }
            let parsed = null;
            try {
                parsed = JSON.parse(raw);
            } catch {
                parsed = null;
            }
            const fileStat = await stat(profilePath).catch(() => null);
            records.push({
                // ★ 完整相对路径：跨来源根唯一
                relativePath: normalizeSourcePath(`${rootName}/${entry.name}`),
                rootName,
                dirName: entry.name,
                legacyProductId: parsed?.productId ?? null,
                displayName: parsed?.identity?.displayName ?? entry.name,
                developmentStage: parsed?.lifecycle?.currentStage ?? null,
                lifecycleStatus: parsed?.lifecycle?.status ?? null,
                archivedAt: parsed?.lifecycle?.archivedAt ?? parsed?.archive?.archivedAt ?? null,
                createdAt: parsed?.lifecycle?.createdAt ?? null,
                profileSha256: createHash("sha256").update(raw, "utf8").digest("hex"),
                profileBytes: Buffer.byteLength(raw, "utf8"),
                mtime: fileStat ? fileStat.mtime.toISOString() : null,
                parseError: parsed ? null : "JSON_PARSE_ERROR"
            });
        }
    }
    return records;
}

/** 目录内容概况：用于人工判断「同一产品的两次归档」还是「两个不同产品」 */
async function describeDirectory(record) {
    const dir = path.join(ROOT, record.rootName, record.dirName);
    const info = { images: 0, outputFiles: 0, hasFacts: false, imageNames: [], factsSize: 0 };
    try {
        const images = await readdir(path.join(dir, "产品图")).catch(() => []);
        info.images = images.length;
        info.imageNames = images.slice(0, 5);
    } catch {
        /* 无产品图目录 */
    }
    try {
        const out = await readdir(path.join(dir, "output")).catch(() => []);
        info.outputFiles = out.length;
    } catch {
        /* 无 output 目录 */
    }
    try {
        const facts = await stat(path.join(dir, "product-facts.json"));
        info.hasFacts = true;
        info.factsSize = facts.size;
    } catch {
        /* 无 facts */
    }
    return info;
}

console.log("\n=== 产品身份映射审计 ===\n");

const records = await scanProfiles();
console.log(`扫描来源根: ${SOURCE_ROOTS.join(" / ")}`);
console.log(`找到 product-profile.json: ${records.length} 份`);

/* ── 分来源根计数（口径必须说清：只看 已完成产品 是 151，三个根合计更多）── */
const perRoot = {};
for (const record of records) {
    perRoot[record.rootName] = perRoot[record.rootName] ?? { files: 0, uniqueIds: new Set() };
    perRoot[record.rootName].files += 1;
    if (record.legacyProductId) perRoot[record.rootName].uniqueIds.add(record.legacyProductId);
}
for (const [rootName, info] of Object.entries(perRoot)) {
    console.log(`  ${rootName}: ${info.files} 份 / ${info.uniqueIds.size} 个唯一 productId`);
}

/* ── 1. 完整相对路径唯一性 ── */
const pathKeys = new Map();
const duplicatePaths = [];
for (const record of records) {
    if (pathKeys.has(record.relativePath)) duplicatePaths.push(record.relativePath);
    else pathKeys.set(record.relativePath, record);
}
console.log(`完整相对路径唯一数: ${pathKeys.size}（重复 ${duplicatePaths.length}）`);

/* ── 2. productId 唯一性 / 重复组 ── */
const byProductId = new Map();
for (const record of records) {
    if (!record.legacyProductId) continue;
    if (!byProductId.has(record.legacyProductId)) byProductId.set(record.legacyProductId, []);
    byProductId.get(record.legacyProductId).push(record);
}
const duplicatedGroups = [...byProductId.entries()].filter(([, list]) => list.length > 1);
console.log(`唯一 legacy productId: ${byProductId.size}`);
console.log(`被多目录共用的 productId 组: ${duplicatedGroups.length}`);

const duplicateDetail = [];
for (const [productId, list] of duplicatedGroups) {
    console.log(`\n  productId ${productId}（${list.length} 个目录）`);
    const members = [];
    for (const record of list) {
        const info = await describeDirectory(record);
        console.log(`    - ${record.relativePath}`);
        console.log(`        档案 sha256=${record.profileSha256.slice(0, 12)}… 大小=${record.profileBytes}B mtime=${record.mtime}`);
        console.log(`        产品图=${info.images} output=${info.outputFiles} facts=${info.hasFacts ? info.factsSize + "B" : "缺失"}`);
        members.push({ ...record, directory: info });
    }
    // 判定线索（不做判定，只列证据）
    const sameProfile = new Set(members.map((m) => m.profileSha256)).size === 1;
    duplicateDetail.push({
        productId,
        groupSize: list.length,
        members,
        evidence: {
            profileBytesIdentical: sameProfile,
            note: sameProfile
                ? "两份档案字节相同 → 更像是同一产品被重复归档"
                : "两份档案内容不同 → 更像是一次归档后又被修改，或产品本身不同；须人工判断"
        }
    });
}

/* ── 3. 映射键格式：source_system + source_record_type + 完整相对路径 ── */
const candidateMappings = records.map((record) => {
    const keyParts = {
        sourceSystem: record.rootName === "已完成产品" ? "product-profile" : record.rootName,
        sourceRecordType: "product-profile",
        sourceRecordId: record.relativePath,
        legacyProductId: record.legacyProductId
    };
    return { ...keyParts, sourceKey: sourceKey(keyParts) };
});
const candidateKeyCounts = new Map();
for (const mapping of candidateMappings) {
    candidateKeyCounts.set(mapping.sourceKey, (candidateKeyCounts.get(mapping.sourceKey) ?? 0) + 1);
}
const candidateKeyCollisions = [...candidateKeyCounts.entries()].filter(([, count]) => count > 1);
console.log(`\n候选映射键（source_system|source_record_type|完整相对路径）: ${candidateMappings.length} 条`);
console.log(`键冲突: ${candidateKeyCollisions.length}`);

const pathLikeCheck = candidateMappings.filter((mapping) => !mapping.sourceRecordId.includes("/"));
console.log(`source_record_id 不含 "/" 的条数（应为 0）: ${pathLikeCheck.length}`);

/* ── 4. 真跑一遍 service：验证 legacy_product_id 保留 + 幂等 + 不合并 ── */
const tempDir = path.join(ROOT, ".tmp-identity-audit");
await mkdir(tempDir, { recursive: true });
const service = new ProductIdentityService({ dataDir: tempDir });
await service.load();

const registered = [];
for (const record of records) {
    const created = await service.registerProduct({
        productName: record.displayName,
        sourceSystem: record.rootName === "已完成产品" ? "product-profile" : record.rootName,
        sourceRecordType: "product-profile",
        sourceRecordId: record.relativePath,
        legacyProductId: record.legacyProductId,
        mappingStatus: "PROVISIONAL",
        evidenceRef: `productId=${record.legacyProductId}; profileSha256=${record.profileSha256.slice(0, 16)}`
    });
    registered.push({ path: record.relativePath, productId: created.product_id, created: created.created });
}

const keyAudit = service.auditMappingKeys({ expectPathLikeFor: ["product-profile"] });
console.log(`\n—— service 实跑结果 ——`);
console.log(`规范产品数: ${service.listProducts().length}`);
console.log(`映射数: ${keyAudit.totalMappings}`);
console.log(`键冲突: ${keyAudit.duplicateKeys.length}`);
console.log(`source_record_id 非路径形态: ${keyAudit.nonPathLikeSourceIds.length}`);
console.log(`缺 legacy_product_id: ${keyAudit.mappingsMissingLegacyProductId.length}`);
console.log(`跨来源系统的产品: ${keyAudit.productsWithMultipleSourceSystems.length}`);

/* ── 5. 幂等重放：同路径二次注册必须返回同一 productId ── */
const replaySample = records.slice(0, 10);
let replayMismatch = 0;
for (const record of replaySample) {
    const again = await service.registerProduct({
        productName: record.displayName + "（改名）",
        sourceSystem: record.rootName === "已完成产品" ? "product-profile" : record.rootName,
        sourceRecordType: "product-profile",
        sourceRecordId: record.relativePath,
        legacyProductId: record.legacyProductId
    });
    const original = registered.find((entry) => entry.path === record.relativePath);
    if (!original || again.product_id !== original.productId) replayMismatch += 1;
    if (again.created) replayMismatch += 1;
}
console.log(`幂等重放抽样 ${replaySample.length} 条，不一致: ${replayMismatch}`);

/* ── 6. 重复组是否被自动合并（必须「没有」） ── */
const mergeCheck = duplicateDetail.map((group) => {
    const productIds = group.members.map(
        (member) => registered.find((entry) => entry.path === member.relativePath)?.productId ?? null
    );
    return {
        legacyProductId: group.productId,
        paths: group.members.map((member) => member.relativePath),
        assignedProductIds: productIds,
        autoMerged: new Set(productIds.filter(Boolean)).size === 1,
        expected: "NOT_MERGED"
    };
});
console.log(`\n—— 重复组是否被自动合并 ——`);
for (const check of mergeCheck) {
    console.log(`  ${check.legacyProductId}: ${check.autoMerged ? "❌ 被合并了" : "✅ 保持独立"}（${check.paths.length} 条 → ${new Set(check.assignedProductIds.filter(Boolean)).size} 个 UUID）`);
}

/* ── 7. 自动合并风险扫描：是否有任何相似度逻辑 ── */
const serviceSource = await readFile(path.join(ROOT, "dist/src/product-identity-service.js"), "utf8");
const similarityHints = ["similar", "levenshtein", "fuzzy", "jaccard", "cosine", "textDistance", "compareName"];
const similarityHits = similarityHints.filter((hint) => serviceSource.toLowerCase().includes(hint.toLowerCase()));
console.log(`\n身份服务中的相似度匹配代码: ${similarityHits.length ? similarityHits.join(", ") : "无（不存在任何按名称/图片合并的逻辑）"}`);

/* ── 输出报告 ── */
const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    sourceRoots: SOURCE_ROOTS,
    totals: {
        profiles: records.length,
        perRoot: Object.fromEntries(
            Object.entries(perRoot).map(([rootName, info]) => [rootName, { files: info.files, uniqueProductIds: info.uniqueIds.size }])
        ),
        uniquePathKeys: pathKeys.size,
        duplicatePaths,
        uniqueLegacyProductIds: byProductId.size,
        duplicatedProductIdGroups: duplicatedGroups.length,
        parseErrors: records.filter((record) => record.parseError).length
    },
    mappingKeyDesign: {
        composition: "source_system + source_record_type + 完整相对路径",
        sampleKeys: candidateMappings.slice(0, 5).map((mapping) => ({
            sourceKey: mapping.sourceKey,
            legacyProductId: mapping.legacyProductId
        })),
        collisions: candidateKeyCollisions,
        nonPathLikeCount: pathLikeCheck.length
    },
    duplicateGroups: duplicateDetail,
    serviceRun: {
        productsCreated: service.listProducts().length,
        mappings: keyAudit.totalMappings,
        keyAudit,
        idempotentReplayMismatch: replayMismatch,
        autoMergeCheck: mergeCheck
    },
    similarityLogic: { hints: similarityHints, found: similarityHits },
    records
};

await mkdir(path.join(ROOT, "_verify"), { recursive: true });
const outFile = path.join(ROOT, "_verify/identity-audit.json");
await writeFile(outFile, JSON.stringify(report, null, 2), "utf8");
console.log(`\n审计报告: ${outFile}`);

/* 清理临时身份库（只删本次审计产生的目录） */
const { rm } = await import("node:fs/promises");
await rm(tempDir, { recursive: true, force: true });

console.log("\n=== 审计完成（未写入正式 data/identity/，未修改任何产品档案）===\n");
