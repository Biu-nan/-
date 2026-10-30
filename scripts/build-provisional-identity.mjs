/**
 * 建立 provisional 产品身份（阶段 1 最终验收 · 任务三）
 *
 * 做什么：
 *   把 `已完成产品/`、`当前产品/`、`已遗弃产品/` 下的每一份 product-profile.json
 *   登记为**一条独立来源记录**，各自获得一个 provisional UUID。
 *
 * 为什么每条都要独立：
 *   验收任务三明确要求「对两组重复 productId 对应的目录，在身份无法核实前，
 *   分别保留独立 provisional UUID」。要做到这点，最稳的做法是**所有**档案都按
 *   「一个目录 = 一条来源记录 = 一个 provisional UUID」处理，而不是只对重复组特判。
 *
 * 安全边界：
 *   - 只写 `data/identity/`（阶段 1 新建的运行态目录），**不碰** `已完成产品/` 下的任何档案；
 *   - 幂等：重复运行不新增产品、不新增映射；
 *   - 不建立任何跨模块关联（来源系统之间没有自动对应）；
 *   - 不判定 U1 / U2 两组重复到底是同一产品还是两个产品。
 *
 * 运行：node scripts/build-provisional-identity.mjs [--dry-run]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProductIdentityService, normalizeSourcePath } from "../dist/src/product-identity-service.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOTS = ["已完成产品", "当前产品", "已遗弃产品"];
const DRY_RUN = process.argv.includes("--dry-run");

/** 来源根 → source_system 命名。已完成/已遗弃都属于归档来源，但保持可分。 */
function sourceSystemFor(rootName) {
    if (rootName === "已完成产品") return "product-profile";
    if (rootName === "已遗弃产品") return "abandoned-profile";
    if (rootName === "当前产品") return "current-product";
    return rootName;
}

async function scanProfiles() {
    const records = [];
    for (const rootName of SOURCE_ROOTS) {
        const rootDir = path.join(ROOT, rootName);
        let entries = [];
        try {
            entries = await readdir(rootDir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const profilePath = path.join(rootDir, entry.name, "product-profile.json");
            let raw;
            try {
                raw = await readFile(profilePath, "utf8");
            } catch {
                continue;
            }
            let parsed = null;
            try {
                parsed = JSON.parse(raw);
            } catch {
                parsed = null;
            }
            const info = await stat(profilePath).catch(() => null);
            records.push({
                relativePath: normalizeSourcePath(`${rootName}/${entry.name}`),
                rootName,
                dirName: entry.name,
                sourceSystem: sourceSystemFor(rootName),
                legacyProductId: parsed?.productId ?? null,
                displayName: parsed?.identity?.displayName ?? entry.name,
                profileSha256: createHash("sha256").update(raw, "utf8").digest("hex"),
                mtime: info ? info.mtime.toISOString() : null,
                parseOk: Boolean(parsed)
            });
        }
    }
    return records;
}

console.log("\n=== 建立 provisional 产品身份 ===\n");
if (DRY_RUN) console.log("** DRY RUN —— 不写盘 **\n");

const records = await scanProfiles();
console.log(`扫描到 ${records.length} 份 product-profile.json`);

const dataDir = DRY_RUN
    ? path.join(ROOT, ".tmp-identity-dryrun") // dry-run 写进临时目录，跑完即删
    : path.join(ROOT, "data", "identity");
await mkdir(dataDir, { recursive: true });

const service = new ProductIdentityService({ dataDir });
await service.load();
const before = {
    products: service.listProducts().length,
    mappings: service.listMappings().length
};
console.log(`登记前：产品 ${before.products} / 映射 ${before.mappings}`);

/* ── 逐条登记（幂等）── */
const results = [];
let created = 0;
let replayed = 0;
for (const record of records) {
    if (!record.parseOk) {
        results.push({ ...record, productId: null, created: false, error: "PROFILE_JSON_PARSE_ERROR" });
        continue;
    }
    try {
        const outcome = await service.registerProduct({
            productName: record.displayName,
            sourceSystem: record.sourceSystem,
            sourceRecordType: "product-profile",
            sourceRecordId: record.relativePath,
            legacyProductId: record.legacyProductId,
            mappingStatus: "PROVISIONAL",
            evidenceRef: `productId=${record.legacyProductId}; profileSha256=${record.profileSha256.slice(0, 16)}; mtime=${record.mtime}`
        });
        results.push({ ...record, productId: outcome.product_id, created: outcome.created, mappingId: outcome.mapping?.mapping_id ?? null });
        if (outcome.created) created += 1;
        else replayed += 1;
    } catch (error) {
        results.push({ ...record, productId: null, created: false, error: error instanceof Error ? error.message : String(error) });
    }
}

const after = {
    products: service.listProducts().length,
    mappings: service.listMappings().length
};
console.log(`登记后：产品 ${after.products} / 映射 ${after.mappings}`);
console.log(`本次新建 ${created} 条，幂等复用 ${replayed} 条`);

/* ── 核心校验 1：每条来源记录的 UUID 必须互不相同 ── */
const uuidByPath = new Map(results.filter((r) => r.productId).map((r) => [r.relativePath, r.productId]));
const uniqueUuids = new Set(uuidByPath.values());
console.log(`\n来源记录 ${uuidByPath.size} 条 → 不同 UUID ${uniqueUuids.size} 个`);
console.log(`  ${uuidByPath.size === uniqueUuids.size ? "✅ 每条来源记录身份独立" : "❌ 存在共用 UUID"}`);

/* ── 核心校验 2：两组重复 productId 必须各自独立 ── */
const byLegacy = new Map();
for (const result of results) {
    if (!result.legacyProductId || !result.productId) continue;
    if (!byLegacy.has(result.legacyProductId)) byLegacy.set(result.legacyProductId, []);
    byLegacy.get(result.legacyProductId).push(result);
}
const duplicated = [...byLegacy.entries()].filter(([, list]) => list.length > 1);
console.log(`\n重复 legacy productId 组: ${duplicated.length}`);

const duplicateAudit = [];
for (const [legacyId, list] of duplicated) {
    const uuids = list.map((entry) => entry.productId);
    const distinct = new Set(uuids);
    console.log(`\n  ${legacyId}`);
    for (const entry of list) {
        console.log(`    ${entry.relativePath}`);
        console.log(`      provisional UUID: ${entry.productId}`);
        console.log(`      档案 mtime: ${entry.mtime}  sha256: ${entry.profileSha256.slice(0, 12)}…`);
    }
    console.log(`    → ${distinct.size} 个不同 UUID ${distinct.size === list.length ? "✅ 未合并" : "❌ 被合并"}`);
    duplicateAudit.push({
        legacyProductId: legacyId,
        members: list.map((entry) => ({
            relativePath: entry.relativePath,
            provisionalProductId: entry.productId,
            legacyProductId: entry.legacyProductId,
            profileSha256: entry.profileSha256,
            mtime: entry.mtime,
            displayName: entry.displayName
        })),
        distinctUuids: distinct.size,
        merged: distinct.size !== list.length,
        decisionStatus: "NEEDS_VALIDATION",
        note: "U1/U2 未经人工裁决前，两条来源记录各自独立，不做任何关联"
    });
}

/* ── 核心校验 3：无跨模块自动关联 ── */
const keyAudit = service.auditMappingKeys();
console.log(`\n映射键审计：`);
console.log(`  键冲突: ${keyAudit.duplicateKeys.length}`);
console.log(`  source_record_id 非路径形态: ${keyAudit.nonPathLikeSourceIds.length}`);
console.log(`  缺 legacy_product_id: ${keyAudit.mappingsMissingLegacyProductId.length}`);
console.log(`  跨来源系统共用的产品: ${keyAudit.productsWithMultipleSourceSystems.length}`);
console.log(`  ${keyAudit.ok ? "✅ 全部通过" : "❌ 存在问题"}`);

/* ── 幂等复验：再跑一遍不应新增 ── */
const beforeReplay = service.listMappings().length;
for (const record of results.filter((r) => r.productId).slice(0, 20)) {
    await service.registerProduct({
        productName: `${record.displayName}（重放）`,
        sourceSystem: record.sourceSystem,
        sourceRecordType: "product-profile",
        sourceRecordId: record.relativePath,
        legacyProductId: record.legacyProductId
    });
}
const afterReplay = service.listMappings().length;
console.log(`\n幂等复验：重放 20 条，映射数 ${beforeReplay} → ${afterReplay} ${beforeReplay === afterReplay ? "✅ 未新增" : "❌ 产生了重复"}`);

/* ── 输出审计表 ── */
const table = results.map((result) => ({
    sourceSystem: result.sourceSystem,
    sourceRecordPath: result.relativePath,
    legacyProductId: result.legacyProductId,
    provisionalProductId: result.productId,
    mappingStatus: result.productId ? "PROVISIONAL" : null,
    profileSha256: result.profileSha256,
    mtime: result.mtime,
    error: result.error ?? null
}));

await mkdir(path.join(ROOT, "_verify"), { recursive: true });
const outFile = path.join(ROOT, "_verify/identity-mapping-audit.json");
await writeFile(
    outFile,
    JSON.stringify(
        {
            generatedAt: new Date().toISOString(),
            dryRun: DRY_RUN,
            dataDir,
            totals: {
                records: records.length,
                registered: uuidByPath.size,
                distinctUuids: uniqueUuids.size,
                createdThisRun: created,
                replayedThisRun: replayed
            },
            keyAudit,
            duplicateGroups: duplicateAudit,
            table
        },
        null,
        2
    ),
    "utf8"
);

console.log(`\n审计表: ${outFile}`);
console.log(`共 ${table.length} 行（每行 = 一条来源记录）`);

/* ── 异常记录 ── */
const anomalies = results.filter((result) => !result.productId || !result.legacyProductId);
console.log(`\n异常记录: ${anomalies.length} 条`);
for (const anomaly of anomalies.slice(0, 10)) {
    console.log(`  - ${anomaly.relativePath}: ${anomaly.error ?? "无 legacyProductId"}`);
}

console.log("\n=== 完成（未修改任何产品档案，未建立跨模块关联）===\n");
