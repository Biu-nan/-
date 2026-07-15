import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_COLLECTION_TASKS_FILE, LISTING_CARDS_FILE, LISTING_SKU_MAPPINGS_FILE, OPERATION_ACTIONS_FILE, OPERATION_PROFILES_FILE, OPERATION_RULES_FILE, PERFORMANCE_SNAPSHOTS_FILE, PROJECT_ROOT, STORE_PROFILES_FILE } from "./config.js";
import { enqueueFileWrite } from "./json-write-queue.js";
const PRODUCT_TIERS = ["normal", "potential", "hot", "paused", "dead"];
const STORE_ROLES = ["main", "test", "distribution"];
const STORE_STATUSES = ["enabled", "disabled"];
const LISTING_LIFECYCLES = [
    "not_listed",
    "listed",
    "observing",
    "first_order",
    "growing",
    "stable",
    "declining",
    "dead",
    "offline"
];
const ACTION_STATUSES = [
    "suggested",
    "approved",
    "executing",
    "done",
    "cancelled"
];
const SKU_MAPPING_STATUSES = [
    "active",
    "inactive",
    "archived"
];
const LIGHTWEIGHT_ENTRY_REASONS = {
    new_product_development: "新开发新品建档",
    live_legacy_import: "已在售老品补建档",
    asset_ready_pending_listing: "已有素材，等待上架接入",
    inventory_driven: "现货库存驱动建档"
};
const LIGHTWEIGHT_OPERATION_GOALS = {
    new_product_development: "完成上新生产线，形成可上架资产",
    live_legacy_import: "接入经营系统，完成 SKU 映射和首个周期数据采集",
    asset_ready_pending_listing: "已有素材，等待上架接入",
    inventory_driven: "基于现货库存创建链接或绑定已有链接"
};
const DEFAULT_RULES = {
    auto_judgement_rules: [
        {
            rule_id: "HAS_ADD_TO_CART_NO_ORDER",
            name: "有加购但订单少",
            enabled: true,
            suggested_action: "检查价格、详情页和优惠承接"
        }
    ],
    threshold_required_rules: [
        {
            rule_id: "POTENTIAL_CTR_LOW",
            name: "有曝光但 CTR 低",
            enabled: true,
            suggested_action: "测主图",
            metric: "ctr",
            threshold: 0.01
        },
        {
            rule_id: "ADS_ROI_LOW",
            name: "广告 ROI 偏低",
            enabled: true,
            suggested_action: "检查关键词、出价和转化承接",
            metric: "roi",
            threshold: 1
        }
    ],
    manual_confirmation_rules: [
        {
            rule_id: "CVR_ABOVE_CATEGORY",
            name: "CVR 高于同类商品平均水平",
            enabled: true,
            suggested_action: "人工确认类目基准后判断是否升级爆品"
        }
    ],
    action_suggestion_rules: [
        {
            rule_id: "REVIEW_DUE",
            name: "运营动作到期复盘",
            enabled: true,
            suggested_action: "填写复盘结果并决定继续、放大或停止"
        }
    ]
};
export class OperationService {
    operationProfilesFile;
    storeProfilesFile;
    listingCardsFile;
    listingSkuMappingsFile;
    performanceSnapshotsFile;
    dataCollectionTasksFile;
    operationActionsFile;
    operationRulesFile;
    constructor(options = {}) {
        this.operationProfilesFile = options.operationProfilesFile ?? OPERATION_PROFILES_FILE;
        this.storeProfilesFile = options.storeProfilesFile ?? STORE_PROFILES_FILE;
        this.listingCardsFile = options.listingCardsFile ?? LISTING_CARDS_FILE;
        this.listingSkuMappingsFile =
            options.listingSkuMappingsFile ?? LISTING_SKU_MAPPINGS_FILE;
        this.performanceSnapshotsFile =
            options.performanceSnapshotsFile ?? PERFORMANCE_SNAPSHOTS_FILE;
        this.dataCollectionTasksFile =
            options.dataCollectionTasksFile ?? DATA_COLLECTION_TASKS_FILE;
        this.operationActionsFile = options.operationActionsFile ?? OPERATION_ACTIONS_FILE;
        this.operationRulesFile = options.operationRulesFile ?? OPERATION_RULES_FILE;
    }
    async initialize() {
        await mkdir(PROJECT_ROOT, { recursive: true });
        await Promise.all([
            this.ensureJson(this.operationProfilesFile, []),
            this.ensureJson(this.storeProfilesFile, []),
            this.ensureJson(this.listingCardsFile, []),
            this.ensureJson(this.listingSkuMappingsFile, []),
            this.ensureJson(this.performanceSnapshotsFile, []),
            this.ensureJson(this.dataCollectionTasksFile, []),
            this.ensureJson(this.operationActionsFile, []),
            this.ensureJson(this.operationRulesFile, DEFAULT_RULES)
        ]);
    }
    async dashboard(productLibrary) {
        const data = await this.files();
        return {
            ...data,
            products: this.mergeProducts(productLibrary, data)
        };
    }
    async upsertOperationProfile(input) {
        const productId = this.required(input.product_id, "product_id");
        const profiles = await this.readArray(this.operationProfilesFile);
        const index = profiles.findIndex((item) => item.product_id === productId);
        const existing = index >= 0 ? profiles[index] : undefined;
        const now = new Date().toISOString();
        const profile = {
            product_id: productId,
            product_tier: this.enumValue(input.product_tier ?? existing?.product_tier ?? "normal", PRODUCT_TIERS, "product_tier"),
            current_operation_goal: this.text(input.current_operation_goal ?? existing?.current_operation_goal),
            entry_reason: this.text(input.entry_reason ?? existing?.entry_reason),
            current_strategy: this.text(input.current_strategy ?? existing?.current_strategy),
            next_review_at: this.text(input.next_review_at ?? existing?.next_review_at),
            linked_listing_ids: existing?.linked_listing_ids ?? [],
            latest_snapshot_id: existing?.latest_snapshot_id,
            latest_action_id: existing?.latest_action_id,
            agent_summary: this.text(input.agent_summary ?? existing?.agent_summary),
            current_operation_plan: this.plan(input.current_operation_plan ?? existing?.current_operation_plan),
            updated_at: now
        };
        if (index >= 0)
            profiles[index] = profile;
        else
            profiles.push(profile);
        await this.writeJson(this.operationProfilesFile, profiles);
        return profile;
    }
    async createDefaultOperationProfile(input) {
        const sourceTag = this.text(input.sourceTag) || "new_product_development";
        const nextAction = this.text(input.nextAction);
        return this.upsertOperationProfile({
            product_id: input.product_id,
            product_tier: "normal",
            current_operation_goal: LIGHTWEIGHT_OPERATION_GOALS[sourceTag] ??
                LIGHTWEIGHT_OPERATION_GOALS.new_product_development,
            entry_reason: this.text(input.entry_reason) ||
                LIGHTWEIGHT_ENTRY_REASONS[sourceTag] ||
                LIGHTWEIGHT_ENTRY_REASONS.new_product_development,
            current_strategy: nextAction || "等待下一步经营动作",
            next_review_at: "",
            agent_summary: `轻量建档来源：${sourceTag}`
        });
    }
    async upsertStoreProfile(input) {
        const stores = await this.readArray(this.storeProfilesFile);
        const storeId = this.text(input.store_id) || randomUUID();
        const index = stores.findIndex((item) => item.store_id === storeId);
        const existing = index >= 0 ? stores[index] : undefined;
        const store = {
            store_id: storeId,
            store_alias: this.required(input.store_alias ?? existing?.store_alias, "store_alias"),
            platform: this.text(input.platform ?? existing?.platform) || "AliExpress",
            hitoor_env_name: this.text(input.hitoor_env_name ?? existing?.hitoor_env_name),
            hitoor_env_id: this.text(input.hitoor_env_id ?? existing?.hitoor_env_id),
            store_role: this.enumValue(input.store_role ?? existing?.store_role ?? "test", STORE_ROLES, "store_role"),
            status: this.enumValue(input.status ?? existing?.status ?? "enabled", STORE_STATUSES, "status"),
            remark: this.text(input.remark ?? existing?.remark),
            updated_at: new Date().toISOString()
        };
        if (index >= 0)
            stores[index] = store;
        else
            stores.push(store);
        await this.writeJson(this.storeProfilesFile, stores);
        return store;
    }
    async upsertListingCard(input) {
        const productId = this.required(input.product_id, "product_id");
        const storeId = this.required(input.store_id, "store_id");
        const stores = await this.readArray(this.storeProfilesFile);
        if (!stores.some((store) => store.store_id === storeId)) {
            throw new Error("请先在店铺与环境设置中创建该 store_id");
        }
        const cards = await this.readArray(this.listingCardsFile);
        const listingId = this.text(input.listing_id) || randomUUID();
        const index = cards.findIndex((item) => item.listing_id === listingId);
        const existing = index >= 0 ? cards[index] : undefined;
        const card = {
            listing_id: listingId,
            product_id: productId,
            store_id: storeId,
            inventory_sku: this.text(input.inventory_sku ?? existing?.inventory_sku),
            platform_product_id: this.text(input.platform_product_id ?? existing?.platform_product_id),
            listing_title: this.text(input.listing_title ?? existing?.listing_title),
            listing_status: this.text(input.listing_status ?? existing?.listing_status),
            target_bag_model: this.text(input.target_bag_model ?? existing?.target_bag_model),
            target_size: this.text(input.target_size ?? existing?.target_size),
            listing_url: this.text(input.listing_url ?? existing?.listing_url),
            image_version: this.text(input.image_version ?? existing?.image_version),
            title_version: this.text(input.title_version ?? existing?.title_version),
            listing_lifecycle: this.enumValue(input.listing_lifecycle ?? existing?.listing_lifecycle ?? "not_listed", LISTING_LIFECYCLES, "listing_lifecycle"),
            latest_snapshot_id: existing?.latest_snapshot_id,
            latest_action_id: existing?.latest_action_id,
            updated_at: new Date().toISOString()
        };
        if (index >= 0)
            cards[index] = card;
        else
            cards.push(card);
        await this.writeJson(this.listingCardsFile, cards);
        await this.ensureListingOnProfile(productId, listingId);
        return card;
    }
    async upsertListingSkuMapping(input) {
        const listingId = this.required(input.listing_id, "listing_id");
        const listing = await this.requireListing(listingId);
        const mappings = await this.readArray(this.listingSkuMappingsFile);
        const mappingId = this.text(input.mapping_id) || randomUUID();
        const index = mappings.findIndex((item) => item.mapping_id === mappingId);
        const existing = index >= 0 ? mappings[index] : undefined;
        const mapping = {
            mapping_id: mappingId,
            listing_id: listingId,
            product_id: listing.product_id,
            store_id: listing.store_id,
            platform_product_id: this.text(input.platform_product_id ??
                existing?.platform_product_id ??
                listing.platform_product_id),
            platform_sku_id: this.text(input.platform_sku_id ?? existing?.platform_sku_id),
            seller_sku_code: this.text(input.seller_sku_code ?? existing?.seller_sku_code),
            platform_barcode: this.text(input.platform_barcode ?? existing?.platform_barcode),
            variant_name: this.text(input.variant_name ?? existing?.variant_name),
            color: this.text(input.color ?? existing?.color),
            size: this.text(input.size ?? existing?.size),
            inventory_sku: this.text(input.inventory_sku ?? existing?.inventory_sku ?? listing.inventory_sku),
            warehouse_sku: this.text(input.warehouse_sku ?? existing?.warehouse_sku),
            status: this.enumValue(input.status ?? existing?.status ?? "active", SKU_MAPPING_STATUSES, "status"),
            remark: this.text(input.remark ?? existing?.remark),
            updated_at: new Date().toISOString()
        };
        if (index >= 0)
            mappings[index] = mapping;
        else
            mappings.push(mapping);
        await this.writeJson(this.listingSkuMappingsFile, mappings);
        return mapping;
    }
    async validateLegacyProductOnboarding(input) {
        const data = await this.files();
        this.prepareLegacyProductOnboarding(input, data);
    }
    async createLegacyProductOnboarding(input) {
        const data = await this.files();
        const prepared = this.prepareLegacyProductOnboarding(input, data);
        const nextData = {
            ...data,
            operationProfiles: [
                ...data.operationProfiles.filter((profile) => profile.product_id !== prepared.operationProfile.product_id),
                prepared.operationProfile
            ],
            listingCards: [...data.listingCards, prepared.listingCard],
            listingSkuMappings: prepared.mapping
                ? [...data.listingSkuMappings, prepared.mapping]
                : data.listingSkuMappings
        };
        try {
            await this.writeOperationCollections(nextData);
        }
        catch (error) {
            await this.writeOperationCollections(data).catch(() => undefined);
            throw error;
        }
        return prepared;
    }
    async createDataCollectionTask(input) {
        const listingId = this.required(input.target_listing_id, "target_listing_id");
        const listing = await this.requireListing(listingId);
        const skuMapping = input.platform_sku_id
            ? await this.requireSkuMapping(listingId, input.platform_sku_id)
            : undefined;
        const tasks = await this.readArray(this.dataCollectionTasksFile);
        const now = new Date().toISOString();
        const task = {
            task_id: randomUUID(),
            target_listing_id: listingId,
            platform_product_id: listing.platform_product_id || undefined,
            platform_sku_id: skuMapping?.platform_sku_id,
            related_plan_id: this.text(input.related_plan_id),
            review_due_at: this.required(input.review_due_at, "review_due_at"),
            period: this.required(input.period, "period"),
            status: "pending",
            created_at: now,
            updated_at: now
        };
        tasks.push(task);
        await this.writeJson(this.dataCollectionTasksFile, tasks);
        return task;
    }
    async createPerformanceSnapshot(input) {
        const listingId = this.required(input.listing_id, "listing_id");
        const listing = await this.requireListing(listingId);
        const skuMapping = input.platform_sku_id
            ? await this.requireSkuMapping(listingId, input.platform_sku_id)
            : undefined;
        const snapshots = await this.readArray(this.performanceSnapshotsFile);
        const snapshot = this.snapshot({
            ...input,
            platform_product_id: listing.platform_product_id,
            platform_sku_id: skuMapping?.platform_sku_id
        });
        snapshots.push(snapshot);
        await this.writeJson(this.performanceSnapshotsFile, snapshots);
        await this.updateListing(listingId, { latest_snapshot_id: snapshot.snapshot_id });
        await this.updateOperationProfileLink(listing.product_id, {
            latest_snapshot_id: snapshot.snapshot_id
        });
        if (input.task_id) {
            await this.markTaskFilled(input.task_id, snapshot.snapshot_id);
        }
        return snapshot;
    }
    async createOperationAction(input) {
        const productId = this.required(input.product_id, "product_id");
        const listingId = this.required(input.listing_id, "listing_id");
        await this.requireListing(listingId);
        const actions = await this.readArray(this.operationActionsFile);
        const action = {
            action_id: randomUUID(),
            product_id: productId,
            listing_id: listingId,
            related_plan_id: this.text(input.related_plan_id),
            snapshot_before_id: this.text(input.snapshot_before_id),
            snapshot_after_id: this.text(input.snapshot_after_id),
            action_type: this.required(input.action_type, "action_type"),
            reason: this.text(input.reason),
            target_metric: this.text(input.target_metric),
            observation_period: this.text(input.observation_period),
            operator: this.text(input.operator),
            operator_id: this.text(input.operator_id),
            operator_name: this.text(input.operator_name),
            created_by_operator_id: this.text(input.created_by_operator_id),
            created_by_operator_name: this.text(input.created_by_operator_name),
            updated_by_operator_id: this.text(input.updated_by_operator_id),
            updated_by_operator_name: this.text(input.updated_by_operator_name),
            status: this.enumValue(input.status ?? "suggested", ACTION_STATUSES, "status"),
            review_status: this.reviewStatus(input.review_due_at, input.status),
            review_result: this.text(input.review_result),
            agent_conclusion: this.text(input.agent_conclusion),
            created_at: new Date().toISOString(),
            review_due_at: this.text(input.review_due_at)
        };
        actions.push(action);
        await this.writeJson(this.operationActionsFile, actions);
        await this.updateListing(listingId, { latest_action_id: action.action_id });
        await this.updateOperationProfileLink(productId, {
            latest_action_id: action.action_id
        });
        return action;
    }
    async updateOperationAction(input) {
        const actionId = this.required(input.action_id, "action_id");
        const actions = await this.readArray(this.operationActionsFile);
        const index = actions.findIndex((action) => action.action_id === actionId);
        if (index === -1)
            throw new Error("未找到运营动作");
        const existing = actions[index];
        const updated = {
            ...existing,
            status: input.status
                ? this.enumValue(input.status, ACTION_STATUSES, "status")
                : existing.status,
            review_result: input.review_result !== undefined
                ? this.text(input.review_result)
                : existing.review_result,
            agent_conclusion: input.agent_conclusion !== undefined
                ? this.text(input.agent_conclusion)
                : existing.agent_conclusion,
            snapshot_after_id: input.snapshot_after_id !== undefined
                ? this.text(input.snapshot_after_id)
                : existing.snapshot_after_id,
            updated_by_operator_id: input.updated_by_operator_id !== undefined
                ? this.text(input.updated_by_operator_id)
                : existing.updated_by_operator_id,
            updated_by_operator_name: input.updated_by_operator_name !== undefined
                ? this.text(input.updated_by_operator_name)
                : existing.updated_by_operator_name,
            review_status: input.review_result !== undefined && this.text(input.review_result)
                ? "reviewed"
                : this.reviewStatus(existing.review_due_at, input.status ?? existing.status)
        };
        actions[index] = updated;
        await this.writeJson(this.operationActionsFile, actions);
        return updated;
    }
    async deleteOperationProfile(productId) {
        return this.deleteByKey(this.operationProfilesFile, "product_id", productId);
    }
    async deleteStoreProfile(storeId) {
        return this.deleteByKey(this.storeProfilesFile, "store_id", storeId);
    }
    async deleteListingCard(listingId) {
        const deleted = await this.deleteByKey(this.listingCardsFile, "listing_id", listingId);
        if (deleted) {
            await this.deleteManyByKey(this.listingSkuMappingsFile, "listing_id", listingId);
        }
        return deleted;
    }
    async deleteListingSkuMapping(mappingId) {
        return this.deleteByKey(this.listingSkuMappingsFile, "mapping_id", mappingId);
    }
    async deleteDataCollectionTask(taskId) {
        return this.deleteByKey(this.dataCollectionTasksFile, "task_id", taskId);
    }
    async deletePerformanceSnapshot(snapshotId) {
        return this.deleteByKey(this.performanceSnapshotsFile, "snapshot_id", snapshotId);
    }
    async deleteOperationAction(actionId) {
        return this.deleteByKey(this.operationActionsFile, "action_id", actionId);
    }
    async files() {
        return {
            operationProfiles: await this.readArray(this.operationProfilesFile),
            storeProfiles: await this.readArray(this.storeProfilesFile),
            listingCards: await this.readArray(this.listingCardsFile),
            listingSkuMappings: await this.readArray(this.listingSkuMappingsFile),
            performanceSnapshots: await this.readArray(this.performanceSnapshotsFile),
            dataCollectionTasks: await this.readArray(this.dataCollectionTasksFile),
            operationActions: await this.readArray(this.operationActionsFile),
            operationRules: await this.readJson(this.operationRulesFile, DEFAULT_RULES)
        };
    }
    prepareLegacyProductOnboarding(input, data) {
        const productId = this.required(input.product_id, "product_id");
        const storeId = this.required(input.store_id, "store_id");
        const platformProductId = this.required(input.platform_product_id, "platform_product_id");
        if (!data.storeProfiles.some((store) => store.store_id === storeId)) {
            throw new Error("请先在店铺与环境设置中创建该 store_id");
        }
        if (data.listingCards.some((listing) => listing.store_id === storeId &&
            listing.platform_product_id === platformProductId)) {
            throw new Error("该店铺下已存在相同 platform_product_id 的链接数据卡");
        }
        const listingUrl = this.text(input.listing_url);
        if (listingUrl &&
            data.listingCards.some((listing) => listing.listing_url === listingUrl)) {
            throw new Error("该 listing_url 已存在，不能重复接入");
        }
        const platformSkuId = this.text(input.platform_sku_id);
        if (platformSkuId &&
            data.listingSkuMappings.some((mapping) => mapping.platform_sku_id === platformSkuId)) {
            throw new Error("该 platform_sku_id 已存在，不能重复绑定");
        }
        const sellerSkuCode = this.text(input.seller_sku_code);
        const skuInventorySku = this.text(input.sku_inventory_sku ?? input.inventory_sku);
        if (sellerSkuCode) {
            const conflict = data.listingSkuMappings.find((mapping) => mapping.seller_sku_code === sellerSkuCode &&
                (mapping.product_id !== productId ||
                    (skuInventorySku && mapping.inventory_sku !== skuInventorySku)));
            if (conflict) {
                throw new Error("该 seller_sku_code 已绑定到其他商品或库存 SKU");
            }
        }
        const now = new Date().toISOString();
        const listingId = randomUUID();
        const listingCard = {
            listing_id: listingId,
            product_id: productId,
            store_id: storeId,
            inventory_sku: this.text(input.inventory_sku),
            platform_product_id: platformProductId,
            listing_title: this.text(input.listing_title),
            listing_status: this.text(input.listing_status),
            target_bag_model: this.text(input.target_bag_model),
            target_size: this.text(input.target_size),
            listing_url: listingUrl,
            image_version: this.text(input.image_version),
            title_version: this.text(input.title_version),
            listing_lifecycle: this.enumValue(input.listing_lifecycle ?? "listed", LISTING_LIFECYCLES, "listing_lifecycle"),
            updated_at: now
        };
        const mapping = platformSkuId || sellerSkuCode || this.text(input.platform_barcode)
            ? {
                mapping_id: randomUUID(),
                listing_id: listingId,
                product_id: productId,
                store_id: storeId,
                platform_product_id: platformProductId,
                platform_sku_id: platformSkuId,
                seller_sku_code: sellerSkuCode,
                platform_barcode: this.text(input.platform_barcode),
                variant_name: this.text(input.variant_name),
                color: this.text(input.color),
                size: this.text(input.size),
                inventory_sku: skuInventorySku,
                warehouse_sku: this.text(input.warehouse_sku),
                status: "active",
                remark: "老品补建档时创建",
                updated_at: now
            }
            : undefined;
        const operationProfile = {
            product_id: productId,
            product_tier: "normal",
            current_operation_goal: "接入经营系统，完成 SKU 映射和首个周期数据采集",
            entry_reason: "已在售老品补建档",
            current_strategy: "先补齐平台商品 ID、SKU 映射和 7 天周期数据",
            next_review_at: "",
            linked_listing_ids: [listingId],
            latest_snapshot_id: undefined,
            latest_action_id: undefined,
            agent_summary: "该商品为已在售老品补建档，当前重点是完成平台实体映射和首个经营周期观察",
            current_operation_plan: undefined,
            updated_at: now
        };
        return { operationProfile, listingCard, mapping };
    }
    async writeOperationCollections(data) {
        await Promise.all([
            this.writeJson(this.operationProfilesFile, data.operationProfiles),
            this.writeJson(this.storeProfilesFile, data.storeProfiles),
            this.writeJson(this.listingCardsFile, data.listingCards),
            this.writeJson(this.listingSkuMappingsFile, data.listingSkuMappings),
            this.writeJson(this.performanceSnapshotsFile, data.performanceSnapshots),
            this.writeJson(this.dataCollectionTasksFile, data.dataCollectionTasks),
            this.writeJson(this.operationActionsFile, data.operationActions),
            this.writeJson(this.operationRulesFile, data.operationRules)
        ]);
    }
    mergeProducts(library, data) {
        return library
            .filter((product) => product.status === "normal" && product.productId)
            .map((product) => {
            const operationProfile = data.operationProfiles.find((profile) => profile.product_id === product.productId);
            const listingCards = data.listingCards.filter((listing) => listing.product_id === product.productId);
            const latestSnapshot = data.performanceSnapshots.find((snapshot) => snapshot.snapshot_id === operationProfile?.latest_snapshot_id);
            const latestAction = data.operationActions.find((action) => action.action_id === operationProfile?.latest_action_id);
            const reviewAlerts = data.operationActions.filter((action) => action.product_id === product.productId &&
                ["pending_review", "overdue"].includes(action.review_status)).length;
            return {
                ...product,
                operationProfile,
                listingCount: listingCards.length,
                latestSnapshot,
                latestAction,
                reviewAlerts
            };
        });
    }
    snapshot(input) {
        const impressions = this.number(input.impressions);
        const clicks = this.number(input.clicks);
        const orders = this.number(input.orders);
        const revenue = this.number(input.revenue);
        const adSpend = this.number(input.ad_spend);
        const refundCount = this.number(input.refund_count);
        const snapshot = {
            snapshot_id: randomUUID(),
            listing_id: this.required(input.listing_id, "listing_id"),
            platform_product_id: this.text(input.platform_product_id) || undefined,
            platform_sku_id: this.text(input.platform_sku_id) || undefined,
            period_start: this.required(input.period_start, "period_start"),
            period_end: this.required(input.period_end, "period_end"),
            impressions,
            visitors: this.number(input.visitors),
            clicks,
            add_to_cart: this.number(input.add_to_cart),
            orders,
            revenue,
            ad_spend: adSpend,
            refund_count: refundCount,
            bad_reviews: this.number(input.bad_reviews),
            disputes: this.number(input.disputes),
            search_terms: this.text(input.search_terms),
            inventory_status: this.text(input.inventory_status),
            ctr: this.divide(clicks, impressions),
            cvr: this.divide(orders, clicks),
            roi: this.divide(revenue, adSpend),
            refund_rate: this.divide(refundCount, orders),
            suggestions: [],
            created_at: new Date().toISOString()
        };
        snapshot.suggestions = this.suggestions(snapshot);
        return snapshot;
    }
    suggestions(snapshot) {
        const suggestions = [];
        if ((snapshot.add_to_cart ?? 0) > 0 && (snapshot.orders ?? 0) === 0) {
            suggestions.push("有加购但订单少：建议检查价格、详情页承接和优惠信息。");
        }
        if ((snapshot.impressions ?? 0) > 0 && snapshot.ctr !== undefined && snapshot.ctr < 0.01) {
            suggestions.push("有曝光但 CTR 偏低：建议进入测图或标题测试。");
        }
        if ((snapshot.ad_spend ?? 0) > 0 && snapshot.roi !== undefined && snapshot.roi < 1) {
            suggestions.push("广告 ROI 偏低：建议检查关键词、出价和转化承接。");
        }
        if (!suggestions.length)
            suggestions.push("已保存周期数据，建议按人工规则判断是否调整运营计划。");
        return suggestions;
    }
    reviewStatus(reviewDueAt, status) {
        if (status === "done") {
            const due = this.text(reviewDueAt);
            if (!due)
                return "not_due";
            const dueAt = new Date(due).getTime();
            if (!Number.isFinite(dueAt))
                return "not_due";
            const now = Date.now();
            if (dueAt > now)
                return "not_due";
            return now - dueAt > 24 * 60 * 60 * 1000 ? "overdue" : "pending_review";
        }
        if (status === "cancelled")
            return "reviewed";
        return "not_due";
    }
    plan(value) {
        if (!value)
            return undefined;
        return {
            plan_id: this.text(value.plan_id) || randomUUID(),
            plan_type: value.plan_type,
            objective: this.text(value.objective),
            start_date: this.text(value.start_date),
            end_date: this.text(value.end_date),
            target_metric: this.text(value.target_metric),
            success_condition: this.text(value.success_condition),
            failure_condition: this.text(value.failure_condition)
        };
    }
    async ensureListingOnProfile(productId, listingId) {
        const profiles = await this.readArray(this.operationProfilesFile);
        const index = profiles.findIndex((profile) => profile.product_id === productId);
        if (index === -1) {
            await this.upsertOperationProfile({ product_id: productId });
            return this.ensureListingOnProfile(productId, listingId);
        }
        const profile = profiles[index];
        if (!profile.linked_listing_ids.includes(listingId)) {
            profile.linked_listing_ids.push(listingId);
            profile.updated_at = new Date().toISOString();
            await this.writeJson(this.operationProfilesFile, profiles);
        }
    }
    async updateOperationProfileLink(productId, update) {
        const profiles = await this.readArray(this.operationProfilesFile);
        const index = profiles.findIndex((profile) => profile.product_id === productId);
        if (index === -1)
            return;
        profiles[index] = {
            ...profiles[index],
            ...update,
            updated_at: new Date().toISOString()
        };
        await this.writeJson(this.operationProfilesFile, profiles);
    }
    async updateListing(listingId, update) {
        const listings = await this.readArray(this.listingCardsFile);
        const index = listings.findIndex((listing) => listing.listing_id === listingId);
        if (index === -1)
            return;
        listings[index] = {
            ...listings[index],
            ...update,
            updated_at: new Date().toISOString()
        };
        await this.writeJson(this.listingCardsFile, listings);
    }
    async markTaskFilled(taskId, snapshotId) {
        const tasks = await this.readArray(this.dataCollectionTasksFile);
        const index = tasks.findIndex((task) => task.task_id === taskId);
        if (index === -1)
            return;
        tasks[index] = {
            ...tasks[index],
            snapshot_id: snapshotId,
            status: "analyzed",
            updated_at: new Date().toISOString()
        };
        await this.writeJson(this.dataCollectionTasksFile, tasks);
    }
    async deleteByKey(file, key, value) {
        const items = await this.readArray(file);
        const next = items.filter((item) => String(item[key] ?? "") !== value);
        if (next.length === items.length)
            return false;
        await this.writeJson(file, next);
        return true;
    }
    async deleteManyByKey(file, key, value) {
        const items = await this.readArray(file);
        const next = items.filter((item) => String(item[key] ?? "") !== value);
        if (next.length !== items.length)
            await this.writeJson(file, next);
    }
    async requireListing(listingId) {
        const listings = await this.readArray(this.listingCardsFile);
        const listing = listings.find((item) => item.listing_id === listingId);
        if (!listing)
            throw new Error("未找到链接数据卡");
        return listing;
    }
    async requireSkuMapping(listingId, platformSkuId) {
        const mappings = await this.readArray(this.listingSkuMappingsFile);
        const mapping = mappings.find((item) => item.listing_id === listingId && item.platform_sku_id === platformSkuId);
        if (!mapping)
            throw new Error("未找到该链接下的平台 SKU 映射");
        return mapping;
    }
    async ensureJson(file, fallback) {
        try {
            await readFile(file, "utf8");
        }
        catch {
            await this.writeJson(file, fallback);
        }
    }
    async readArray(file) {
        const value = await this.readJson(file, []);
        return Array.isArray(value) ? value : [];
    }
    async readJson(file, fallback) {
        try {
            return JSON.parse(await readFile(file, "utf8"));
        }
        catch {
            return fallback;
        }
    }
    async writeJson(file, value) {
        await mkdir(path.dirname(file), { recursive: true });
        await enqueueFileWrite(file, async () => {
            const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
            await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
            await rename(temporary, file);
        });
    }
    enumValue(value, allowed, label) {
        const text = this.text(value);
        if (allowed.includes(text))
            return text;
        throw new Error(`${label} 不合法`);
    }
    required(value, label) {
        const text = this.text(value);
        if (!text)
            throw new Error(`${label} 不能为空`);
        return text;
    }
    text(value) {
        return String(value ?? "").trim();
    }
    number(value) {
        if (value === "" || value === undefined || value === null)
            return undefined;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : undefined;
    }
    divide(numerator, denominator) {
        if (numerator === undefined ||
            denominator === undefined ||
            denominator <= 0)
            return undefined;
        return Number((numerator / denominator).toFixed(6));
    }
}
//# sourceMappingURL=operation-service.js.map