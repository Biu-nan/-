// 爆款研究中心 · 服务编排
// 职责：
//  - ingest：导入爆款（用户上传图 + 手填指标；若给 URL 则 CDP 自动开 Chrome 截图+抓字段）
//  - analyze：把记录交给 research-analyzer 跑 ChatGPT 多模态拆解（chatgpt 适配器由 server 注入）
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright-core";
import { CHROME_DEBUG_PORT, HOT_PRODUCTS_DIR, DISCOVER_DIR } from "./config.js";
import { ResearchStore, newHotProductId, emptyRecord } from "./research-store.js";
import { analyzeHotProduct } from "./research-analyzer.js";

function sha256Of(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

function mimeFromName(name, fallback) {
    const ext = path.extname(name).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    return fallback || "image/jpeg";
}

function safeName(name, index) {
    const base = path.basename(name).replace(/[^\w.\-]+/g, "_").replace(/_{2,}/g, "_");
    return `${String(index).padStart(2, "0")}_${base}`;
}

// 最佳努力：用现有 Chrome（CDP）打开 URL，截图主视区并抓取标题/价格。
// 失败不影响主流程——metrics 以用户手填为准，截图为视觉增强。
async function captureFromUrl(url, outDir) {
    let browser;
    try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);
        const context = browser.contexts()[0];
        if (!context) return null; // 无可用上下文，安全降级为手填
        const page = await context.newPage();
        const navDone = page
            .goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
            .catch(() => {});
        await Promise.race([navDone, new Promise((r) => setTimeout(r, 45_000))]);
        await page.waitForTimeout(4_000); // 等 SPA 渲染
        const shot = await page.screenshot({ fullPage: false });
        const fileName = `capture_${Date.now()}.png`;
        const filePath = path.join(outDir, fileName);
        await writeFile(filePath, shot);
        const meta = await page
            .evaluate(() => {
                const title =
                    document.querySelector("h1")?.textContent?.trim() ||
                    document.title?.trim() ||
                    "";
                const priceEl = [...document.querySelectorAll("*")].find(
                    (e) =>
                        e.children.length === 0 &&
                        /[$¥€£]\s?[\d.,]+|[\d.,]+\s?(USD|CNY|EUR|GBP)/i.test(e.textContent || "")
                );
                const price = priceEl ? priceEl.textContent.trim() : "";
                return { title, price };
            })
            .catch(() => ({ title: "", price: "" }));
        await page.close().catch(() => {});
        return { filePath, fileName, meta };
    }
    catch (err) {
        console.warn("[research] CDP 自动抓取失败，回退为手填：", err?.message || err);
        return null;
    }
    // 注意：不关闭 browser（与 chatgpt-adapter 共享同一个 Chrome 实例）
}

// ===== 发现源（二阶段）：反向图搜 + 免费门户关键词搜 =====
// 原则：不写反爬爬虫，只走已登录的共享 Chrome（CDP）。打开官方/门户搜索页 →
// 截图供人眼确认 + 最佳努力抓候选帖 URL/标题/缩略图/互动数 → 返回「候选列表」由人工点选导入。
// 精确锁定「就是这条最先带火」平台不公开传播链路，故定位为强候选 + 人工确认，不宣称自动锁定。

// 各平台搜索深链构造（关键词模式）。这些链接本身即有价值——抓取失败也能让用户一键打开门户。
function buildPortalLinks(query) {
    const q = encodeURIComponent(query || "");
    return [
        { platform: "tiktok", label: "TikTok 视频搜索", url: `https://www.tiktok.com/search/video?q=${q}`, kind: "portal-search" },
        { platform: "tiktok-cc", label: "TikTok Creative Center 热门", url: "https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en", kind: "portal-trend" },
        { platform: "meta-ads", label: "Meta 广告库", url: `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${q}&search_type=keyword_unordered`, kind: "portal-search" },
        { platform: "youtube", label: "YouTube（按播放量）", url: `https://www.youtube.com/results?search_query=${q}&sp=CAMSAhAB`, kind: "portal-search" },
        { platform: "google-images", label: "Google 图片", url: `https://www.google.com/search?tbm=isch&q=${q}`, kind: "portal-search" },
        { platform: "google-lens", label: "Google Lens（反向图搜·需手动传图）", url: "https://lens.google.com/", kind: "reverse-image" },
        { platform: "tineye", label: "TinEye（反向图搜·需手动传图）", url: "https://tineye.com/", kind: "reverse-image" }
    ];
}

// 平台特定的候选抽取（在页面上下文里执行；DOM 易变，故最佳努力 + 通用兜底）
async function scrapeCandidates(page, platform, limit) {
    return page
        .evaluate(
            ({ platform, limit }) => {
                const abs = (u) => {
                    try { return new URL(u, location.href).href; } catch { return u; }
                };
                const clean = (t) => (t || "").replace(/\s+/g, " ").trim().slice(0, 90);
                const seen = new Set();
                const out = [];
                const push = (url, title, thumb, metrics) => {
                    if (!url || seen.has(url)) return;
                    seen.add(url);
                    out.push({ url: abs(url), title: clean(title), thumb: thumb ? abs(thumb) : "", metrics: metrics || {} });
                };
                let anchors = [];
                if (platform === "youtube") {
                    anchors = [...document.querySelectorAll("a#video-title, a#thumbnail")];
                    for (const a of anchors) {
                        if (!/\/watch\?/.test(a.href || "")) continue;
                        const card = a.closest("ytd-video-renderer") || a.parentElement;
                        const title = a.getAttribute("title") || a.textContent;
                        const thumb = card?.querySelector("img")?.src || "";
                        const meta = clean(card?.querySelector("#metadata-line")?.textContent || "");
                        push(a.href, title, thumb, meta ? { info: meta } : {});
                        if (out.length >= limit) break;
                    }
                } else if (platform === "tiktok") {
                    anchors = [...document.querySelectorAll('a[href*="/video/"]')];
                    for (const a of anchors) {
                        const card = a.closest("div");
                        const thumb = card?.querySelector("img")?.src || "";
                        const title = card?.querySelector('[data-e2e="search-card-desc"], img')?.getAttribute?.("alt") || card?.textContent;
                        push(a.href, title, thumb, {});
                        if (out.length >= limit) break;
                    }
                } else {
                    anchors = [...document.querySelectorAll("a[href]")].filter((a) => a.querySelector("img"));
                    for (const a of anchors) {
                        const img = a.querySelector("img");
                        push(a.href, img?.alt || a.textContent, img?.src, {});
                        if (out.length >= limit) break;
                    }
                }
                return out;
            },
            { platform, limit }
        )
        .catch(() => []);
}

// 对单个门户搜索页：打开 → 截图 → 抓候选。共享 Chrome，不新建上下文、不关浏览器。
async function discoverOnePortal(context, sessionDir, link, query, limit) {
    const result = { platform: link.platform, label: link.label, url: link.url, kind: link.kind, screenshot: null, candidates: [] };
    let page;
    try {
        page = await context.newPage();
        const nav = page.goto(link.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
        await Promise.race([nav, new Promise((r) => setTimeout(r, 45_000))]);
        await page.waitForTimeout(4_000);
        const shotName = `${link.platform}.png`;
        const shotPath = path.join(sessionDir, shotName);
        await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {});
        result.screenshot = shotName;
        result.candidates = await scrapeCandidates(page, link.platform, limit);
    }
    catch (err) {
        console.warn(`[research/discover] ${link.platform} 抓取失败：`, err?.message || err);
    }
    finally {
        await page?.close().catch(() => {});
    }
    return result;
}

async function saveImageAsset(file, outDir, index, source) {
    const fileName = safeName(file.originalname || `img_${index}.jpg`, index);
    const filePath = path.join(outDir, "images", fileName);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.buffer);
    const sha = sha256Of(file.buffer);
    return {
        assetId: `ra_${sha.slice(0, 12)}`,
        fileName,
        mimeType: mimeFromName(fileName, file.mimetype),
        sha256: sha,
        localPath: filePath,
        source
    };
}

export const ResearchService = {
    async ingest({ sourceUrl, category, platform, metrics = {}, files = [] }) {
        const id = newHotProductId();
        const dir = path.join(HOT_PRODUCTS_DIR, id);
        await mkdir(path.join(dir, "images"), { recursive: true });

        const record = emptyRecord(id);
        record.sourcePlatform = platform || "";
        record.sourceUrl = sourceUrl || "";
        record.category = category || "";
        record.identity = {
            title: metrics.title || "",
            brand: metrics.brand || "",
            price: metrics.price ?? null,
            currency: metrics.currency || "",
            captureDate: record.createdAt,
            thumbAssetId: null
        };
        record.metrics = {
            salesVolume: metrics.salesVolume ?? null,
            salesRank: metrics.salesRank ?? null,
            rating: metrics.rating ?? null,
            reviewCount: metrics.reviewCount ?? null,
            wishlistCount: metrics.wishlistCount ?? null,
            price: metrics.price ?? null,
            currency: metrics.currency || "",
            capturedAt: null
        };

        const assets = [];
        let index = 0;
        for (const file of files) {
            assets.push(await saveImageAsset(file, dir, index++, "upload"));
        }

        if (sourceUrl) {
            const captured = await captureFromUrl(sourceUrl, dir);
            if (captured) {
                const capBuf = await readFile(captured.filePath);
                const sha = sha256Of(capBuf);
                assets.push({
                    assetId: `ra_${sha.slice(0, 12)}`,
                    fileName: captured.fileName,
                    mimeType: "image/png",
                    sha256: sha,
                    localPath: captured.filePath,
                    source: "capture"
                });
                record.metrics.capturedAt = new Date().toISOString();
                if (!record.identity.title && captured.meta.title) {
                    record.identity.title = captured.meta.title;
                }
            }
        }

        record.images.analysis = assets;
        record.identity.thumbAssetId = assets[0]?.assetId || null;
        record.status = "imported";

        return ResearchStore.create(record);
    },

    // 发现源：给定查询词（可选上传参考图），在免费门户/官方页面找候选源帖。
    // files：上传的参考图（用于反向图搜的手动上传引导，仅落盘留存，不做自动反搜）。
    // 返回 { sessionDir, portals, candidates[], reverseImage }，全程最佳努力，抓不到只回退门户深链。
    async discoverSource({ query = "", platforms, files = [], sessionId, limitPerPortal = 8 }) {
        const sessionDir = path.join(DISCOVER_DIR, sessionId || `ds_${Date.now().toString(36)}`);
        await mkdir(sessionDir, { recursive: true });

        // 上传的参考图落盘（供用户在 Google Lens / TinEye 手动反搜时取用）
        const refImages = [];
        let idx = 0;
        for (const file of files) {
            const fileName = safeName(file.originalname || `ref_${idx}.jpg`, idx++);
            const filePath = path.join(sessionDir, fileName);
            await writeFile(filePath, file.buffer);
            refImages.push({ fileName, localPath: filePath });
        }

        const allLinks = buildPortalLinks(query);
        // 关键词搜类门户（可自动打开抓取）；反向图搜类只给深链 + 手动引导
        const wanted = Array.isArray(platforms) && platforms.length
            ? allLinks.filter((l) => platforms.includes(l.platform))
            : allLinks.filter((l) => l.kind === "portal-search"); // 默认只跑可抓取的关键词门户

        const searchLinks = wanted.filter((l) => l.kind === "portal-search");
        const reverseLinks = allLinks.filter((l) => l.kind === "reverse-image");
        const trendLinks = allLinks.filter((l) => l.kind === "portal-trend");

        const portals = [];
        let browser;
        try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);
            const context = browser.contexts()[0];
            if (context) {
                for (const link of searchLinks) {
                    portals.push(await discoverOnePortal(context, sessionDir, link, query, limitPerPortal));
                }
            }
        }
        catch (err) {
            console.warn("[research/discover] CDP 连接失败，仅返回门户深链：", err?.message || err);
        }
        // 无法抓取时，把关键词门户降级为纯深链，保证仍可一键打开
        const scrapedPlatforms = new Set(portals.map((p) => p.platform));
        for (const link of searchLinks) {
            if (!scrapedPlatforms.has(link.platform)) {
                portals.push({ platform: link.platform, label: link.label, url: link.url, kind: link.kind, screenshot: null, candidates: [] });
            }
        }

        // 汇总所有候选（打平，带来源平台）
        const candidates = [];
        for (const p of portals) {
            for (const c of p.candidates) {
                candidates.push({ ...c, platform: p.platform, sourceType: "portal-search", capturedAt: new Date().toISOString() });
            }
        }

        return {
            sessionDir,
            query,
            portals,                       // 每个门户：截图 + 候选
            candidates,                    // 打平的候选列表（供一键导入）
            trendPortals: trendLinks,      // 趋势门户（TikTok Creative Center 等，人工浏览）
            reversePortals: reverseLinks,  // 反向图搜门户（需手动传图）
            refImages
        };
    },

    // 收集用于 ChatGPT 上传的本地图片路径
    imageLocalPaths(record) {
        return (record.images?.analysis || []).map((a) => a.localPath).filter(Boolean);
    },

    // 跑拆解。chatgpt 适配器由 server 注入（adapters.chatgpt）。
    async analyze(record, chatgpt) {
        const imagePaths = this.imageLocalPaths(record);
        const report = await analyzeHotProduct(chatgpt, {
            imagePaths,
            identity: record.identity,
            metrics: record.metrics
        });
        return report;
    },

    // 跨品爆款因子库：把所有「已拆解」爆款的 hitFactors 聚合，按「出现频次 × 平均权重」排名。
    // evidence 仅聚合文本指标（避免跨商品引用图片 asset 导致破图），示例商品给标题便于回跳原记录。
    async factorLibrary() {
        const products = await ResearchStore.list();
        const analyzed = products.filter(
            (p) => p && p.status === "analyzed" && Array.isArray(p.analysis?.hitFactors) && p.analysis.hitFactors.length
        );
        const total = analyzed.length;
        const groups = new Map();
        const DIMENSIONS = ["visual", "data", "content", "price", "review"];
        const REPS = ["copy", "adapt", "reference"];
        for (const p of analyzed) {
            const title = p.identity?.title || p.category || p.sourceUrl || "(未命名)";
            for (const f of p.analysis.hitFactors) {
                const dimension = DIMENSIONS.includes(f.dimension) ? f.dimension : "visual";
                const name = (f.name || "未命名因子").trim();
                const key = `${dimension}::${name.toLowerCase()}`;
                if (!groups.has(key)) {
                    groups.set(key, {
                        key, dimension, name,
                        count: 0,
                        weights: [],
                        replicMap: {},
                        metrics: new Set(),
                        examples: []
                    });
                }
                const g = groups.get(key);
                g.count += 1;
                g.weights.push(Number(f.weight) || 3);
                const rep = REPS.includes(f.replicability) ? f.replicability : "reference";
                g.replicMap[rep] = (g.replicMap[rep] || 0) + 1;
                for (const m of f.evidence?.metrics || []) if (m) g.metrics.add(String(m));
                if (g.examples.length < 6) {
                    g.examples.push({ id: p.id, title, platform: p.sourcePlatform || "" });
                }
            }
        }
        const factors = [...groups.values()].map((g) => {
            const avgWeight = g.weights.reduce((a, b) => a + b, 0) / g.weights.length;
            const maxWeight = Math.max(...g.weights);
            let replicability = "reference";
            let best = -1;
            for (const [k, v] of Object.entries(g.replicMap)) {
                if (v > best) { best = v; replicability = k; }
            }
            return {
                key: g.key,
                dimension: g.dimension,
                name: g.name,
                count: g.count,
                share: total ? g.count / total : 0,
                avgWeight: Math.round(avgWeight * 100) / 100,
                maxWeight,
                replicability,
                metrics: [...g.metrics].slice(0, 8),
                examples: g.examples
            };
        });
        factors.sort((a, b) => (b.count - a.count) || (b.avgWeight - a.avgWeight) || a.name.localeCompare(b.name));
        const byDimension = {};
        for (const f of factors) {
            (byDimension[f.dimension] = byDimension[f.dimension] || []).push(f);
        }
        return { total, factors, byDimension };
    }
};
