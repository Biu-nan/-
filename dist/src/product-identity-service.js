/**
 * 统一 Product 身份层（Phase 1 / YKB-V1-PHASE1-IDENTITY-STATE-20261030-R1）
 *
 * 三件事，只做这三件：
 *   1. 规范 product_id 的唯一注册入口（UUID），新产品只能从这里拿 ID；
 *   2. product_identity_map：把历史来源记录（product-profile / listing-card /
 *      selection-board / charm）映射到规范 UUID，同源重复导入必须幂等；
 *   3. store 主数据叠加层：内部 store UUID + 外部编号字符串分离，
 *      纳物首店 400370 只登记为 PENDING_VERIFICATION / publishing_allowed=false。
 *
 * 为什么不做成 16 张表：
 *   基线 §1.1 明确"不以新建数据库为目标"。这里的三个存储都是**最小必要**：
 *   - products.json：现有 149 份 product-profile 各自为政，没有任何一处能回答
 *     "这个 UUID 是什么产品"，必须有最小主档；
 *   - identity-map.json：跨来源映射无法塞进任何单一来源文件，否则一改就双写；
 *   - store-master.json：store-profiles.json 是生产数据文件，阶段 1 不写生产数据，
 *     故用叠加层（augmentation）引用它而不修改它。
 *
 * 铁律（不可越线）：
 *   - 不按名称 / 图片 / 标题相似度自动合并两个来源记录；
 *   - 不覆盖、不删除任何历史 ID；
 *   - 未核验映射一律 PROVISIONAL / UNRESOLVED，不猜；
 *   - 400370 只是外部编号字符串，永远不是内部主键。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** 映射状态：只有 VERIFIED 才算可依赖。 */
export const MAPPING_STATUS = Object.freeze({
    VERIFIED: "VERIFIED",
    PROVISIONAL: "PROVISIONAL",
    UNRESOLVED: "UNRESOLVED",
    UNRECONCILED: "UNRECONCILED"
});

/** 店铺核验状态。publishing_allowed 只有 VERIFIED 才允许为 true。 */
export const STORE_VERIFICATION = Object.freeze({
    PENDING_VERIFICATION: "PENDING_VERIFICATION",
    VERIFIED: "VERIFIED",
    REJECTED: "REJECTED"
});

const nowIso = () => new Date().toISOString();

/**
 * 来源记录的唯一键：同源同类型同 ID 视为同一条来源记录。
 *
 * `source_record_id` 的语义在阶段 1 验收中明确为
 * **来源系统内的完整相对路径**（如 `已完成产品/肥皂香皂压捏捏乐`），
 * 而不是目录名 —— 因为目录名跨来源根（当前产品 / 已完成产品 / 已遗弃产品）不唯一。
 */
export function sourceKey({ sourceSystem, sourceRecordType, sourceRecordId }) {
    return [sourceSystem, sourceRecordType, sourceRecordId]
        .map((part) => String(part ?? "").trim())
        .join("|");
}

/** 规范化来源记录路径：统一分隔符、去首尾斜杠，保证同一路径只有一个写法。 */
export function normalizeSourcePath(raw) {
    return String(raw ?? "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "");
}

function requireFields(input, fields, label) {
    for (const field of fields) {
        const value = input?.[field];
        if (value === undefined || value === null || String(value).trim() === "") {
            throw new Error(`${label} 缺少必填字段 ${field}`);
        }
    }
}

function compact(value, max = 500) {
    if (value === undefined || value === null) return "";
    return String(value).slice(0, max);
}

function initialProducts() {
    return { schemaVersion: "1.0", products: [], updatedAt: nowIso() };
}
function initialIdentityMap() {
    return { schemaVersion: "1.0", mappings: [], updatedAt: nowIso() };
}
function initialStoreMaster() {
    return {
        schemaVersion: "1.0",
        note: "store-profiles.json 的叠加层：不修改生产文件，只补充内部 UUID / 外部编号 / 核验状态。",
        stores: [],
        updatedAt: nowIso()
    };
}

export class ProductIdentityService {
    pending = Promise.resolve();

    constructor(options = {}) {
        this.dataDir = options.dataDir ?? path.join(process.cwd(), "data", "identity");
        this.productsFile = path.join(this.dataDir, "products.json");
        this.identityMapFile = path.join(this.dataDir, "identity-map.json");
        this.storeMasterFile = path.join(this.dataDir, "store-master.json");
        this.products = initialProducts();
        this.identityMap = initialIdentityMap();
        this.storeMaster = initialStoreMaster();
    }

    /* 串行队列：并发注册不能生成两个 UUID 抢同一个来源记录 */
    enqueue(operation) {
        const next = this.pending.then(operation);
        this.pending = next.catch(() => undefined);
        return next;
    }

    async load() {
        await mkdir(this.dataDir, { recursive: true });
        this.products = await this.readJson(this.productsFile, initialProducts());
        this.identityMap = await this.readJson(this.identityMapFile, initialIdentityMap());
        this.storeMaster = await this.readJson(this.storeMasterFile, initialStoreMaster());
        // 结构兜底：文件被手改成 {} 时不能让后续逻辑炸掉
        if (!Array.isArray(this.products.products)) this.products = initialProducts();
        if (!Array.isArray(this.identityMap.mappings)) this.identityMap = initialIdentityMap();
        if (!Array.isArray(this.storeMaster.stores)) this.storeMaster = initialStoreMaster();
        return this.snapshot();
    }

    async readJson(file, fallback) {
        try {
            const parsed = JSON.parse(await readFile(file, "utf8"));
            return { ...fallback, ...parsed };
        } catch (error) {
            if (error?.code !== "ENOENT") {
                console.warn(`[identity] ${path.basename(file)} 读取失败，使用空结构:`, error?.message ?? error);
                // 保留现场：坏文件改名，不删
                await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => undefined);
            }
            return fallback;
        }
    }

    async writeJson(file, value) {
        value.updatedAt = nowIso();
        const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
        await rename(temp, file);
    }

    snapshot() {
        return {
            products: this.products.products.length,
            mappings: this.identityMap.mappings.length,
            stores: this.storeMaster.stores.length,
            updatedAt: nowIso()
        };
    }

    /* ══ 1. 规范 Product 注册入口 ══
       唯一允许生成 product_id 的地方。带来源信息时同步建立映射（幂等）。 */
    async registerProduct(input = {}) {
        return this.enqueue(async () => {
            requireFields(input, ["productName"], "注册产品");

            const sourceSystem = compact(input.sourceSystem, 80);
            const sourceRecordType = compact(input.sourceRecordType, 80);
            // 完整相对路径（如 `已完成产品/肥皂香皂压捏捏乐`），跨来源根唯一
            const sourceRecordId = input.sourceRecordId
                ? normalizeSourcePath(compact(input.sourceRecordId, 400))
                : "";

            // 带来源的注册：先查已有映射，命中即返回同一个 UUID（幂等）
            if (sourceSystem && sourceRecordType && sourceRecordId) {
                const existing = this.findMapping({ sourceSystem, sourceRecordType, sourceRecordId });
                if (existing) {
                    const product = this.findProduct(existing.product_id);
                    return {
                        product_id: existing.product_id,
                        product: product ?? null,
                        created: false,
                        idempotentReplay: true,
                        mapping: existing
                    };
                }
            }

            const productId = randomUUID();
            const timestamp = nowIso();
            const product = {
                product_id: productId,
                product_name: compact(input.productName, 200),
                development_stage: compact(input.developmentStage, 40) || "DISCOVERED",
                product_notes: compact(input.productNotes, 2000),
                listing_template_ref: compact(input.listingTemplateRef, 200),
                primary_source: sourceSystem
                    ? { source_system: sourceSystem, source_record_type: sourceRecordType, source_record_id: sourceRecordId }
                    : null,
                created_at: timestamp,
                updated_at: timestamp
            };
            this.products.products.push(product);

            let mapping = null;
            if (sourceSystem && sourceRecordType && sourceRecordId) {
                mapping = this.pushMapping({
                    productId,
                    sourceSystem,
                    sourceRecordType,
                    sourceRecordId,
                    mappingStatus: input.mappingStatus ?? MAPPING_STATUS.PROVISIONAL,
                    evidenceRef: compact(input.evidenceRef, 500),
                    legacyProductId: compact(input.legacyProductId, 80) || null
                });
            }

            await this.writeJson(this.productsFile, this.products);
            await this.writeJson(this.identityMapFile, this.identityMap);
            return { product_id: productId, product, created: true, idempotentReplay: false, mapping };
        });
    }

    findProduct(productId) {
        return this.products.products.find((product) => product.product_id === productId) ?? null;
    }

    listProducts() {
        return this.products.products.map((product) => ({ ...product }));
    }

    findMapping({ sourceSystem, sourceRecordType, sourceRecordId }) {
        const key = sourceKey({ sourceSystem, sourceRecordType, sourceRecordId });
        return (
            this.identityMap.mappings.find(
                (mapping) =>
                    sourceKey({
                        sourceSystem: mapping.source_system,
                        sourceRecordType: mapping.source_record_type,
                        sourceRecordId: mapping.source_record_id
                    }) === key
            ) ?? null
        );
    }

    pushMapping({ productId, sourceSystem, sourceRecordType, sourceRecordId, mappingStatus, evidenceRef, legacyProductId }) {
        const mapping = {
            mapping_id: randomUUID(),
            product_id: productId,
            source_system: sourceSystem,
            source_record_type: sourceRecordType,
            source_record_id: sourceRecordId,
            // 历史原值保留：原始来源系统里的 productId。永不覆盖、永不删除、永不当作规范 ID。
            legacy_product_id: legacyProductId ?? null,
            mapping_status: mappingStatus,
            evidence_ref: evidenceRef ?? "",
            created_at: nowIso()
        };
        this.identityMap.mappings.push(mapping);
        return mapping;
    }

    /* ══ 2. 历史 ID 映射（独立入口，用于 dry-run 与人工核验后写入）══
       同一来源记录重复调用返回同一条映射，不新增。 */
    async mapLegacyId(input = {}) {
        return this.enqueue(async () => {
            requireFields(input, ["sourceSystem", "sourceRecordType", "sourceRecordId", "productId"], "建立映射");
            const productId = String(input.productId).trim();
            if (!this.findProduct(productId)) {
                throw new Error(`规范产品 ${productId} 不存在，不能建立映射（先注册产品）`);
            }
            const normalized = {
                sourceSystem: compact(input.sourceSystem, 80),
                sourceRecordType: compact(input.sourceRecordType, 80),
                // 完整相对路径（跨来源根唯一）
                sourceRecordId: normalizeSourcePath(compact(input.sourceRecordId, 400))
            };
            const existing = this.findMapping(normalized);
            if (existing) {
                return { mapping: existing, created: false, idempotentReplay: true };
            }

            /* 禁止未经人工裁决的跨模块自动关联（验收任务三第 8 条）。
               若该规范产品已经挂着别的来源系统的记录，本次映射必须是 VERIFIED（人工确认过），
               否则拒绝 —— 因为没有任何证据说明两个模块里的记录是同一产品。 */
            const mappingStatus = input.mappingStatus ?? MAPPING_STATUS.PROVISIONAL;
            const otherSources = new Set(
                this.identityMap.mappings
                    .filter((mapping) => mapping.product_id === productId)
                    .map((mapping) => mapping.source_system)
            );
            otherSources.delete(normalized.sourceSystem);
            if (otherSources.size > 0 && mappingStatus !== MAPPING_STATUS.VERIFIED) {
                throw new Error(
                    `拒绝跨模块自动关联：规范产品 ${productId} 已关联来源系统 [${[...otherSources].join(", ")}]，` +
                        `来自 ${normalized.sourceSystem} 的记录只有在人工核验后才能映射（需 mappingStatus=VERIFIED）`
                );
            }

            const mapping = this.pushMapping({
                productId,
                ...normalized,
                mappingStatus,
                evidenceRef: compact(input.evidenceRef, 500),
                legacyProductId: compact(input.legacyProductId, 80) || null
            });
            await this.writeJson(this.identityMapFile, this.identityMap);
            return { mapping, created: true, idempotentReplay: false };
        });
    }

    resolveProductId({ sourceSystem, sourceRecordType, sourceRecordId }) {
        const mapping = this.findMapping({ sourceSystem, sourceRecordType, sourceRecordId });
        return mapping ? mapping.product_id : null;
    }

    listMappings() {
        return this.identityMap.mappings.map((mapping) => ({ ...mapping }));
    }

    /* ══ crosswalk dry-run ══
       只读：把传入的来源记录清单与现有映射对账，输出可审查报告，绝不写库。 */
    buildCrosswalkDryRun(records = []) {
        const rows = records.map((record) => {
            const mapping = this.findMapping({
                sourceSystem: record.sourceSystem,
                sourceRecordType: record.sourceRecordType,
                sourceRecordId: record.sourceRecordId
            });
            return {
                sourceSystem: compact(record.sourceSystem, 80),
                sourceRecordType: compact(record.sourceRecordType, 80),
                sourceRecordId: compact(record.sourceRecordId, 160),
                productName: compact(record.productName, 200),
                existingProductId: mapping?.product_id ?? null,
                existingStatus: mapping?.mapping_status ?? null,
                resolution: mapping ? "ALREADY_MAPPED" : "NEEDS_REVIEW"
            };
        });
        const bySource = {};
        for (const row of rows) {
            const key = `${row.sourceSystem}/${row.sourceRecordType}`;
            bySource[key] = (bySource[key] ?? 0) + 1;
        }
        return {
            generatedAt: nowIso(),
            dryRun: true,
            wroteAnything: false,
            totalRecords: rows.length,
            alreadyMapped: rows.filter((row) => row.resolution === "ALREADY_MAPPED").length,
            needsReview: rows.filter((row) => row.resolution === "NEEDS_REVIEW").length,
            bySource,
            rows
        };
    }

    /* ══ 3. store 主数据叠加层 ══
       不修改 store-profiles.json（生产数据文件）。这里只做增量登记与核验状态。 */
    async registerStore(input = {}) {
        return this.enqueue(async () => {
            requireFields(input, ["storeName", "externalStoreCode"], "登记店铺");
            const externalStoreCode = String(input.externalStoreCode).trim();
            // 约束：外部编号必须是字符串，且不得被当成内部主键
            if (!/^[A-Za-z0-9_-]+$/.test(externalStoreCode)) {
                throw new Error(`外部店铺编号格式非法：${externalStoreCode}（只允许字母数字下划线短横）`);
            }
            const existing = this.storeMaster.stores.find(
                (store) => store.external_store_code === externalStoreCode
            );
            if (existing) {
                return { store: existing, created: false, idempotentReplay: true };
            }
            const storeId = randomUUID();
            if (storeId === externalStoreCode) {
                // 理论上不可能（UUID 含短横且 32 位），但显式断言，杜绝"400370 当主键"
                throw new Error("内部 store_id 与外部编号冲突，拒绝登记");
            }
            const store = {
                store_id: storeId,
                store_name: compact(input.storeName, 120),
                external_store_code: externalStoreCode,
                external_id_namespace: compact(input.externalIdNamespace, 120) || "UNKNOWN_PENDING_VERIFICATION",
                verification_status: STORE_VERIFICATION.PENDING_VERIFICATION,
                publishing_allowed: false,
                source: compact(input.source, 80) || "MANUAL_REGISTRATION",
                source_store_id: compact(input.sourceStoreId, 80) || null,
                evidence_ref: compact(input.evidenceRef, 500),
                registered_at: nowIso(),
                updated_at: nowIso()
            };
            this.storeMaster.stores.push(store);
            await this.writeJson(this.storeMasterFile, this.storeMaster);
            return { store, created: true, idempotentReplay: false };
        });
    }

    listStores() {
        return this.storeMaster.stores.map((store) => ({ ...store }));
    }

    /** 发布门禁：核验未通过或缺计划店铺，一律 false。 */
    canPublishToStore(storeId) {
        const store = this.storeMaster.stores.find((entry) => entry.store_id === storeId);
        if (!store) return { allowed: false, reason: "STORE_NOT_REGISTERED" };
        if (store.verification_status !== STORE_VERIFICATION.VERIFIED) {
            return { allowed: false, reason: "STORE_PENDING_VERIFICATION" };
        }
        if (store.publishing_allowed !== true) {
            return { allowed: false, reason: "PUBLISHING_NOT_ALLOWED" };
        }
        return { allowed: true, reason: "OK" };
    }

    /* ══ 映射键完整性审计（只读）══
       回答三个问题：
         1. 有没有两条映射撞同一个 sourceKey（应恒为 0）；
         2. 同一来源系统里，`source_record_id` 有没有重复（应恒为 0）；
         3. legacy_product_id 有没有被丢（历史原值必须可追溯）。 */
    auditMappingKeys(options = {}) {
        const expectPathLike = options.expectPathLikeFor ?? ["product-profile"];
        const byKey = new Map();
        const duplicates = [];
        const missingLegacy = [];
        const nonPathLike = [];

        /* 注意：磁盘上的 mapping 是 snake_case（source_system / source_record_type /
           source_record_id），而 sourceKey() 收的是驼峰参数。这里必须显式转换，
           否则 sourceKey 读到三个 undefined，所有键都会塌成 "||" 造成全量假冲突。 */
        const keyOf = (mapping) =>
            sourceKey({
                sourceSystem: mapping.source_system,
                sourceRecordType: mapping.source_record_type,
                sourceRecordId: mapping.source_record_id
            });

        for (const mapping of this.identityMap.mappings) {
            const key = keyOf(mapping);
            if (byKey.has(key)) {
                duplicates.push({ key, mapping_ids: [byKey.get(key), mapping.mapping_id] });
            } else {
                byKey.set(key, mapping.mapping_id);
            }
            if (expectPathLike.includes(mapping.source_record_type) && !String(mapping.source_record_id).includes("/")) {
                nonPathLike.push({
                    mapping_id: mapping.mapping_id,
                    source_record_type: mapping.source_record_type,
                    source_record_id: mapping.source_record_id,
                    hint: "product-profile 类型的来源记录应使用完整相对路径（含来源根目录），避免跨根同名冲突"
                });
            }
            if (!mapping.legacy_product_id) {
                missingLegacy.push(mapping.mapping_id);
            }
        }

        const productToSources = new Map();
        for (const mapping of this.identityMap.mappings) {
            if (!productToSources.has(mapping.product_id)) productToSources.set(mapping.product_id, []);
            productToSources.get(mapping.product_id).push(keyOf(mapping));
        }
        const multiSourceProducts = [...productToSources.entries()]
            .filter(([, keys]) => new Set(keys.map((key) => key.split("|")[0])).size > 1)
            .map(([productId, keys]) => ({ product_id: productId, sources: keys }));

        return {
            totalMappings: this.identityMap.mappings.length,
            uniqueKeys: byKey.size,
            duplicateKeys: duplicates,
            nonPathLikeSourceIds: nonPathLike,
            mappingsMissingLegacyProductId: missingLegacy,
            productsWithMultipleSourceSystems: multiSourceProducts,
            ok: duplicates.length === 0 && nonPathLike.length === 0 && missingLegacy.length === 0
        };
    }

    /* ══ 幂等键（复用 charm_publish_attempts 的模式）══ */
    static idempotencyKey(parts) {
        return createHash("sha256").update(parts.map((part) => String(part ?? "")).join("|")).digest("hex").slice(0, 32);
    }
}
