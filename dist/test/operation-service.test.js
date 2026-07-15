import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { OperationService } from "../src/operation-service.js";
async function serviceFixture() {
    const directory = await mkdtemp(path.join(os.tmpdir(), "operations-"));
    const service = new OperationService({
        operationProfilesFile: path.join(directory, "operation-profiles.json"),
        storeProfilesFile: path.join(directory, "store-profiles.json"),
        listingCardsFile: path.join(directory, "listing-cards.json"),
        listingSkuMappingsFile: path.join(directory, "listing-sku-mappings.json"),
        performanceSnapshotsFile: path.join(directory, "performance-snapshots.json"),
        dataCollectionTasksFile: path.join(directory, "data-collection-tasks.json"),
        operationActionsFile: path.join(directory, "operation-actions.json"),
        operationRulesFile: path.join(directory, "operation-rules.json")
    });
    await service.initialize();
    return { directory, service };
}
const productLibrary = [
    {
        directoryName: "product-a",
        status: "normal",
        label: "正常",
        productId: "product-1",
        displayName: "测试商品",
        workflowMode: "standard_listing",
        currentStage: "COMPLETED",
        updatedAt: "2026-06-16T00:00:00.000Z"
    }
];
describe("operation service", () => {
    it("stores operation profiles as a collection keyed by product_id", async () => {
        const { directory, service } = await serviceFixture();
        try {
            await service.upsertOperationProfile({
                product_id: "product-1",
                product_tier: "potential",
                current_operation_goal: "验证是否值得放大"
            });
            const raw = JSON.parse(await readFile(path.join(directory, "operation-profiles.json"), "utf8"));
            assert.equal(Array.isArray(raw), true);
            assert.equal(raw[0].product_id, "product-1");
            assert.equal(raw[0].product_tier, "potential");
            assert.equal(raw[0].current_operation_goal, "验证是否值得放大");
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("creates default operation profiles for lightweight product sources", async () => {
        const { directory, service } = await serviceFixture();
        try {
            const assetReady = await service.createDefaultOperationProfile({
                product_id: "product-asset-ready",
                sourceTag: "asset_ready_pending_listing",
                nextAction: "去上架接入"
            });
            const inventoryDriven = await service.createDefaultOperationProfile({
                product_id: "product-inventory",
                sourceTag: "inventory_driven",
                nextAction: "创建链接或绑定已有链接"
            });
            assert.equal(assetReady.entry_reason, "已有素材，等待上架接入");
            assert.equal(assetReady.current_strategy, "去上架接入");
            assert.equal(inventoryDriven.entry_reason, "现货库存驱动建档");
            assert.equal(inventoryDriven.current_operation_goal, "基于现货库存创建链接或绑定已有链接");
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("uses store_id on listing cards and displays store data through store profiles", async () => {
        const { directory, service } = await serviceFixture();
        try {
            const store = await service.upsertStoreProfile({
                store_alias: "主力店 A",
                platform: "AliExpress",
                hitoor_env_name: "Hitoor-A",
                hitoor_env_id: "env-a",
                store_role: "main",
                status: "enabled"
            });
            const listing = await service.upsertListingCard({
                product_id: "product-1",
                store_id: store.store_id,
                platform_product_id: "100500123",
                listing_title: "Test Listing",
                listing_status: "Online",
                inventory_sku: "SKU-A",
                listing_lifecycle: "observing"
            });
            assert.equal(listing.store_id, store.store_id);
            assert.equal(listing.platform_product_id, "100500123");
            assert.equal("store_name" in listing, false);
            assert.equal("wenmai_environment" in listing, false);
            const dashboard = await service.dashboard(productLibrary);
            assert.equal(dashboard.storeProfiles[0].hitoor_env_name, "Hitoor-A");
            assert.equal(dashboard.products[0].listingCount, 1);
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("maps platform SKU variants to internal inventory SKUs", async () => {
        const { directory, service } = await serviceFixture();
        try {
            const store = await service.upsertStoreProfile({ store_alias: "测试店" });
            const listing = await service.upsertListingCard({
                product_id: "product-1",
                store_id: store.store_id,
                platform_product_id: "100500999",
                inventory_sku: "BASE-SKU"
            });
            const silver = await service.upsertListingSkuMapping({
                listing_id: listing.listing_id,
                platform_sku_id: "sku-silver",
                seller_sku_code: "SELLER-SILVER",
                variant_name: "silver",
                inventory_sku: "INV-SILVER"
            });
            const gold = await service.upsertListingSkuMapping({
                listing_id: listing.listing_id,
                platform_sku_id: "sku-gold",
                seller_sku_code: "SELLER-GOLD",
                variant_name: "gold",
                inventory_sku: "INV-GOLD"
            });
            assert.equal(silver.product_id, "product-1");
            assert.equal(silver.store_id, store.store_id);
            assert.equal(silver.platform_product_id, "100500999");
            assert.equal(gold.inventory_sku, "INV-GOLD");
            const dashboard = await service.dashboard(productLibrary);
            assert.equal(dashboard.listingSkuMappings.length, 2);
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("transactionally creates legacy onboarding operation records", async () => {
        const { directory, service } = await serviceFixture();
        try {
            const store = await service.upsertStoreProfile({ store_alias: "老品店" });
            const result = await service.createLegacyProductOnboarding({
                product_id: "product-legacy",
                store_id: store.store_id,
                platform_product_id: "100500legacy",
                listing_url: "https://www.aliexpress.com/item/100500legacy.html",
                listing_title: "Legacy Listing",
                platform_sku_id: "sku-legacy",
                seller_sku_code: "SELLER-LEGACY",
                sku_inventory_sku: "INV-LEGACY",
                warehouse_sku: "WH-LEGACY"
            });
            assert.equal(result.operationProfile.product_tier, "normal");
            assert.equal(result.operationProfile.entry_reason, "已在售老品补建档");
            assert.equal(result.listingCard.product_id, "product-legacy");
            assert.equal(result.mapping?.seller_sku_code, "SELLER-LEGACY");
            const dashboard = await service.dashboard([
                {
                    directoryName: "legacy",
                    status: "normal",
                    label: "正常",
                    productId: "product-legacy",
                    displayName: "老品",
                    workflowMode: "standard_listing",
                    currentStage: "COMPLETED",
                    updatedAt: "2026-06-16T00:00:00.000Z"
                }
            ]);
            assert.equal(dashboard.products[0].listingCount, 1);
            assert.equal(dashboard.operationProfiles[0].agent_summary.includes("已在售老品补建档"), true);
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("rejects duplicate legacy listing identity fields", async () => {
        const { directory, service } = await serviceFixture();
        try {
            const store = await service.upsertStoreProfile({ store_alias: "老品店" });
            await service.createLegacyProductOnboarding({
                product_id: "product-a",
                store_id: store.store_id,
                platform_product_id: "100500dup",
                listing_url: "https://www.aliexpress.com/item/100500dup.html",
                platform_sku_id: "sku-dup",
                seller_sku_code: "SELLER-DUP",
                sku_inventory_sku: "INV-DUP"
            });
            await assert.rejects(() => service.createLegacyProductOnboarding({
                product_id: "product-b",
                store_id: store.store_id,
                platform_product_id: "100500dup"
            }), /platform_product_id/);
            await assert.rejects(() => service.createLegacyProductOnboarding({
                product_id: "product-b",
                store_id: store.store_id,
                platform_product_id: "100500other",
                listing_url: "https://www.aliexpress.com/item/100500dup.html"
            }), /listing_url/);
            await assert.rejects(() => service.createLegacyProductOnboarding({
                product_id: "product-b",
                store_id: store.store_id,
                platform_product_id: "100500other",
                platform_sku_id: "sku-dup"
            }), /platform_sku_id/);
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("rejects seller_sku_code conflicts across products or inventory SKUs", async () => {
        const { directory, service } = await serviceFixture();
        try {
            const store = await service.upsertStoreProfile({ store_alias: "老品店" });
            await service.createLegacyProductOnboarding({
                product_id: "product-a",
                store_id: store.store_id,
                platform_product_id: "100500a",
                seller_sku_code: "SELLER-SHARED",
                sku_inventory_sku: "INV-A"
            });
            await assert.rejects(() => service.createLegacyProductOnboarding({
                product_id: "product-b",
                store_id: store.store_id,
                platform_product_id: "100500b",
                seller_sku_code: "SELLER-SHARED",
                sku_inventory_sku: "INV-A"
            }), /seller_sku_code/);
            await assert.rejects(() => service.createLegacyProductOnboarding({
                product_id: "product-a",
                store_id: store.store_id,
                platform_product_id: "100500c",
                seller_sku_code: "SELLER-SHARED",
                sku_inventory_sku: "INV-B"
            }), /seller_sku_code/);
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("calculates CTR, CVR, ROI and refund_rate from raw snapshot fields", async () => {
        const { directory, service } = await serviceFixture();
        try {
            const store = await service.upsertStoreProfile({ store_alias: "测试店" });
            const listing = await service.upsertListingCard({
                product_id: "product-1",
                store_id: store.store_id,
                platform_product_id: "100500123"
            });
            await service.upsertListingSkuMapping({
                listing_id: listing.listing_id,
                platform_sku_id: "sku-1",
                inventory_sku: "INV-1"
            });
            const snapshot = await service.createPerformanceSnapshot({
                listing_id: listing.listing_id,
                platform_sku_id: "sku-1",
                period_start: "2026-06-01",
                period_end: "2026-06-07",
                impressions: 1000,
                clicks: 50,
                orders: 5,
                revenue: 200,
                ad_spend: 50,
                refund_count: 1
            });
            assert.equal(snapshot.ctr, 0.05);
            assert.equal(snapshot.cvr, 0.1);
            assert.equal(snapshot.roi, 4);
            assert.equal(snapshot.refund_rate, 0.2);
            assert.equal(snapshot.platform_product_id, "100500123");
            assert.equal(snapshot.platform_sku_id, "sku-1");
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("supports action status and review_status separately", async () => {
        const { directory, service } = await serviceFixture();
        try {
            const store = await service.upsertStoreProfile({ store_alias: "测试店" });
            const listing = await service.upsertListingCard({
                product_id: "product-1",
                store_id: store.store_id
            });
            const action = await service.createOperationAction({
                product_id: "product-1",
                listing_id: listing.listing_id,
                action_type: "测图",
                status: "approved",
                review_due_at: "2999-01-01"
            });
            assert.equal(action.status, "approved");
            assert.equal(action.review_status, "not_due");
            const reviewed = await service.updateOperationAction({
                action_id: action.action_id,
                status: "done",
                review_result: "CTR 提升"
            });
            assert.equal(reviewed.status, "done");
            assert.equal(reviewed.review_status, "reviewed");
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=operation-service.test.js.map