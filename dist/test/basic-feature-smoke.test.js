import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
async function readPublicFile(name) {
    return readFile(path.join(process.cwd(), "public", name), "utf8");
}
async function readSourceFile(name) {
    return readFile(path.join(process.cwd(), "src", name), "utf8");
}
const coreViews = [
    "materials",
    "content",
    "images",
    "commerce-products",
    "commerce-product-detail",
    "listing-matrix",
    "commerce-dashboard",
    "data-tasks",
    "operation-actions",
    "operation-review",
    "store-settings"
];
const coreControls = [
    "folderInput",
    "planningButton",
    "imagesButton",
    "seoListingButton",
    "productLibrary",
    "commerceDetailContent",
    "saveListingCardButton",
    "saveSkuMappingButton",
    "legacyOnboardButton",
    "commerceKpis",
    "dataTaskList",
    "operationActionList",
    "operationReviewList",
    "storeProfileList"
];
describe("basic feature smoke guards", () => {
    it("keeps core business view panels in the app shell", async () => {
        const html = await readPublicFile("index.html");
        for (const view of coreViews) {
            assert.match(html, new RegExp(`data-view-panel="${view}"`), `missing core view panel: ${view}`);
        }
    });
    it("keeps core business controls available for event binding", async () => {
        const html = await readPublicFile("index.html");
        for (const control of coreControls) {
            assert.match(html, new RegExp(`id="${control}"`), `missing core control: ${control}`);
        }
    });
    it("keeps Navigation v0.4 fixed to five primary workspaces", async () => {
        const app = await readPublicFile("app.js");
        const navBlock = app.match(/const NAV_WORKSPACES = \[[\s\S]*?\n\];/);
        assert.ok(navBlock, "NAV_WORKSPACES missing");
        for (const label of ["今日指挥台", "目标管理", "业务场景", "知识库", "设置和工具"]) {
            assert.match(navBlock[0], new RegExp(`label: "${label}"`), `missing workspace: ${label}`);
        }
        assert.doesNotMatch(navBlock[0], /label: "工具与 Agent"/);
        assert.doesNotMatch(navBlock[0], /label: "个人效率"/);
    });
    it("keeps legacy business entries reachable through Navigation v0.4 compatibility", async () => {
        const app = await readPublicFile("app.js");
        for (const pair of [
            ['"listing-builder": "content"', "listing-builder alias"],
            ['"image-generator": "images"', "image-generator alias"],
            ['"product-hub": "operation-pool"', "product-hub alias"],
            ['"store-settings": "settings"', "store-settings workspace"],
            ['"daily-operation": "today"', "daily-operation workspace"]
        ]) {
            assert.match(app, new RegExp(pair[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing ${pair[1]}`);
        }
        assert.match(app, /function switchView\(view\)/);
        assert.match(app, /label: "上品", view: "materials"/);
        assert.match(app, /label: "运维", view: "operation-pool"/);
        assert.match(app, /label: "店铺与环境", view: "store-settings"/);
        assert.match(app, /label: "Prompt 库", view: "prompt-library"/);
    });
    it("exposes all backend prompts in the knowledge prompt library", async () => {
        const html = await readPublicFile("index.html");
        const app = await readPublicFile("app.js");
        assert.match(html, /id="promptLibraryList"/);
        assert.match(html, /id="promptLibraryCount"/);
        assert.doesNotMatch(html, /Prompt 库后续接入/);
        for (const kind of [
            "research",
            "planning",
            "seoKeywords",
            "listingContent",
            "luxuryInsert",
            "insertMarketRadar",
            "insertListingContent",
            "marketVisualAuditV2",
            "visualStrategyCompression",
            "visualPlanningV2",
            "singleImagePromptV2",
            "listingImageQcV1"
        ]) {
            assert.match(app, new RegExp(`kind: "${kind}"`), `missing prompt library kind: ${kind}`);
        }
        assert.match(app, /renderPromptLibrary/);
        assert.match(app, /savePromptLibraryItem/);
    });
    it("exposes a manual reset for insert market radar selection", async () => {
        const html = await readPublicFile("index.html");
        const app = await readPublicFile("app.js");
        const server = await readSourceFile("server.ts");
        assert.match(html, /id="resetInsertMarketRadarButton"/);
        assert.match(app, /resetInsertMarketRadarButton/);
        assert.match(app, /resetInsertMarketRadar/);
        assert.match(app, /\/api\/insert\/market-radar\/reset/);
        assert.match(server, /\/api\/insert\/market-radar\/reset/);
    });
    it("keeps secretary and hidden data loop UI placeholders", async () => {
        const html = await readPublicFile("index.html");
        for (const id of [
            "secretaryDrawer",
            "secretaryInput",
            "secretarySend",
            "secretaryModeToggle",
            "secretaryRawOutput",
            "hiddenDataModeBadge",
            "hiddenTestDataToggle",
            "hiddenDashboardJson",
            "hiddenQclawPendingCount",
            "hiddenKnowledgePendingCount"
        ]) {
            assert.match(html, new RegExp(`id="${id}"`), `missing UI placeholder: ${id}`);
        }
        assert.match(html, /class="secretary-shell is-docked"/);
        assert.match(html, /class="secretary-message-list"/);
    });
    it("keeps business scene tabs inside pages instead of primary navigation", async () => {
        const html = await readPublicFile("index.html");
        assert.match(html, /aria-label="上品场景页内入口"/);
        assert.match(html, /data-home-view="content">Listing/);
        assert.match(html, /data-home-view="images">作图/);
        assert.match(html, /aria-label="运维场景页内入口"/);
        assert.match(html, /data-home-view="ad-center">直通车/);
    });
    it("keeps production flow next-step controls visible in the listing workflow", async () => {
        const html = await readPublicFile("index.html");
        for (const text of [
            "保存并进入市场调研",
            "保存并进入 Listing",
            "保存并进入作图",
            "保存并进入上架草稿",
            "保存并进入上架质检",
            "生成 QClaw 上架任务草稿"
        ]) {
            assert.match(html, new RegExp(text), `missing production flow action: ${text}`);
        }
        assert.match(html, /data-flow-action="qclaw-draft"/);
    });
    it("keeps ChatGPT tool selection resilient to composer menu role changes", async () => {
        const app = await readFile(path.join(process.cwd(), "src", "chatgpt-adapter.ts"), "utf8");
        assert.match(app, /getByRole\("menuitemradio"/);
        assert.match(app, /getByRole\("menuitem"/);
        assert.match(app, /getByText\(toolName/);
        assert.match(app, /getByRole\("button"/);
        assert.match(app, /ChatGPT 工具菜单/);
    });
    it("does not hard-stop listing generation when ChatGPT web search cannot be toggled", async () => {
        const service = await readFile(path.join(process.cwd(), "src", "automation-service.ts"), "utf8");
        assert.match(service, /enableWebSearchIfAvailable/);
        assert.equal((service.match(/await this\.ai\.enableWebSearch\(\);/g) ?? []).length, 1);
        assert.match(service, /未能自动启用网页搜索，已降级为直接发送 Prompt/);
    });
    it("keeps core business views reachable from navigation or compatibility mappings", async () => {
        const app = await readPublicFile("app.js");
        assert.match(app, /"commerce-product-detail": "business"/);
        assert.match(app, /content: "business"/);
        assert.match(app, /images: "business"/);
        assert.match(app, /"commerce-products": "business"/);
        assert.match(app, /"listing-matrix": "business"/);
        assert.match(app, /function switchView\(view\)/);
    });
    it("does not force the operator picker to block core features on first load", async () => {
        const app = await readPublicFile("app.js");
        const match = app.match(/async function initializeOperators\(\) \{[\s\S]*?\n\}/);
        assert.ok(match, "initializeOperators function missing");
        assert.doesNotMatch(match[0], /showOperatorModal\(true\)/);
        assert.match(app, /elements\.switchOperatorButton\?\.addEventListener\("click"/);
    });
    it("shows the Listing visual workflow v2 stages without replacing legacy controls", async () => {
        const html = await readPublicFile("index.html");
        for (const id of [
            "listingVisualWorkflow",
            "listingVisualProductFacts",
            "listingVisualMarketAudit",
            "listingVisualStrategy",
            "listingVisualPlan",
            "listingVisualSinglePrompt",
            "listingVisualImageQc",
            "listingVisualImageNumber"
        ]) {
            assert.match(html, new RegExp(`id="${id}"`), `missing listing visual workflow node: ${id}`);
        }
        assert.match(html, /listing-visual-workflow/);
        assert.match(html, /Market Visual Audit/);
        assert.match(html, /Visual Strategy Compression/);
        assert.match(html, /Single Image Prompt/);
        assert.match(html, /Image QC/);
        assert.match(html, /id="imagesButton"/);
        assert.match(html, /id="outputGallery"/);
    });
    it("keeps legacy planning completion available for standard Listing", async () => {
        const service = await readFile(path.join(process.cwd(), "src", "automation-service.ts"), "utf8");
        assert.doesNotMatch(service, /Visual Workflow v2 不会自动补全旧 10 图 Prompt Pack/);
        assert.match(service, /Single Image Prompt Pack/);
        assert.match(service, /视觉规划自动补全指令/);
        assert.match(service, /PLANNING_COMPLETION_PROMPT/);
    });
});
//# sourceMappingURL=basic-feature-smoke.test.js.map