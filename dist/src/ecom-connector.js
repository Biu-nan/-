// ecom-translator 连接器（单向：ecom → 一跨而境）
// 设计要点见 docs/MIGRATION_ECOM_TRANSLATOR.md：
//  - 不合并两套系统，只通过「交接清单 + 文件契约」对话；
//  - 幂等：operationId = sha256(productId + artifacts + direction)，重复导入直接跳过；
//  - 冲突：目标已存在且内容不同 → 不覆盖，落 <target>.incoming-<ts> 并标 CONFLICT；
//  - 不读 ecom 的 .venv/.lama/work，只消费 output/ 下的交付物。
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { toYikuaborderFacts } from "./ecom-contract.js";

async function exists(p) {
    try {
        await access(p);
        return true;
    }
    catch {
        return false;
    }
}

function sha256(text) {
    return createHash("sha256").update(text).digest("hex");
}

async function fileSha256(filePath) {
    const buf = await readFile(filePath);
    return sha256(buf);
}

/** 产品目录名 → 一跨而境产品目录名（去 _images、替换非法字符）。 */
export function sanitizeProductName(folder) {
    return String(folder || "")
        .replace(/_images$/i, "")
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "未命名产品";
}

/** 扫描 ecom output/：支持 output/<分类>/<产品> 与 output/<产品> 两种层级。 */
export async function scanEcomProducts(ecomRoot) {
    const outputDir = path.join(ecomRoot, "output");
    if (!(await exists(outputDir))) {
        return { outputDir, exists: false, products: [] };
    }
    const products = [];
    const entries = await readdir(outputDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
        const firstDir = path.join(outputDir, entry.name);
        // 优先当成产品目录（含 product_info.json）
        if (await exists(path.join(firstDir, "product_info.json"))) {
            products.push({ folder: entry.name, productDir: firstDir, category: "" });
            continue;
        }
        // 否则当成分类目录，向下扫一层
        const children = await readdir(firstDir, { withFileTypes: true }).catch(() => []);
        for (const child of children) {
            if (!child.isDirectory()) continue;
            const productDir = path.join(firstDir, child.name);
            if (await exists(path.join(productDir, "product_info.json"))) {
                products.push({ folder: child.name, productDir, category: entry.name });
            }
        }
    }
    return { outputDir, exists: true, products };
}

async function readJson(filePath) {
    try {
        return JSON.parse(await readFile(filePath, "utf8"));
    }
    catch {
        return null;
    }
}

/** 轻量列表（不计算 sha256），供连接器面板展示。 */
export async function listEcomProductSummaries(ecomRoot) {
    const { outputDir, exists: outputExists, products } = await scanEcomProducts(ecomRoot);
    const list = [];
    for (const product of products) {
        const info = await readJson(path.join(product.productDir, "product_info.json"));
        const handoff = await readJson(path.join(product.productDir, "listing_handoff.json"));
        const quality = info?.quality ?? {};
        const gate = handoff?.delivery_gate ?? {};
        const assets = (handoff?.image_assets ?? []).filter((a) => !a.status || a.status === "SUCCESS");
        list.push({
            folder: product.folder,
            category: product.category,
            name: sanitizeProductName(product.folder),
            status: quality.status ?? null,
            reviewRequired: Boolean(gate.review_required) || Boolean(quality.status && quality.status !== "READY"),
            hasListing: await exists(path.join(product.productDir, "04_LISTING_CONTENT.md")),
            imageCount: assets.length,
            productDir: product.productDir
        });
    }
    return { outputDir, exists: outputExists, products: list };
}

/** 构建单个产品的交接清单（含转换后 facts / 产物清单 / operationId）。 */
export async function buildHandoff(productDir) {
    const info = await readJson(path.join(productDir, "product_info.json"));
    if (!info) throw new Error(`缺少 product_info.json：${productDir}`);
    const handoffDoc = await readJson(path.join(productDir, "listing_handoff.json"));
    const facts = toYikuaborderFacts(info, handoffDoc ?? {});
    const productId = facts.productId || path.basename(productDir);

    const artifacts = [];
    const addArtifact = async (name, kind) => {
        const abs = path.join(productDir, name);
        if (!(await exists(abs))) return;
        const infoStat = await stat(abs);
        artifacts.push({ name, kind, size: infoStat.size, sha256: await fileSha256(abs) });
    };
    await addArtifact("product_info.json", "contract");
    await addArtifact("listing_handoff.json", "contract");
    await addArtifact("03_SEO_KEYWORDS.md", "listing");
    await addArtifact("04_LISTING_CONTENT.md", "listing");

    // 图片：用 facts.meta.provenance.imageAssets（已按 SUCCESS 过滤）
    const imageAssets = facts.meta?.provenance?.imageAssets ?? [];
    for (const asset of imageAssets) {
        const abs = path.join(productDir, path.basename(asset.ecomPath));
        if (!(await exists(abs))) continue;
        const infoStat = await stat(abs);
        artifacts.push({
            name: path.basename(abs),
            kind: asset.kind,
            size: infoStat.size,
            sha256: await fileSha256(abs)
        });
    }

    const artifactSignature = sha256(artifacts.map((a) => `${a.name}:${a.sha256}`).sort().join("|"));
    const operationId = sha256(`${productId}\n${artifactSignature}\necom_to_yikuaborder`);
    return {
        handoffId: operationId.slice(0, 16),
        operationId,
        direction: "ecom_to_yikuaborder",
        productId,
        productDir,
        artifacts,
        facts,
        provenance: facts.meta?.provenance ?? {},
        createdAt: new Date().toISOString()
    };
}

export async function readLedger(ledgerPath) {
    return (await readJson(ledgerPath)) ?? { schemaVersion: 1, entries: [] };
}

async function appendLedger(ledgerPath, entry) {
    const ledger = await readLedger(ledgerPath);
    ledger.entries.push(entry);
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

/**
 * 导入单个产品的交接清单到一跨而境。
 * 返回 { status: "IMPORTED"|"SKIPPED"|"CONFLICT", targetDir, reason? }
 */
export async function importHandoff({ handoff, targetRoot, ledgerPath, dryRun = false }) {
    const targetDir = path.join(targetRoot, sanitizeProductName(handoff.productId));
    const incomingFactsJson = `${JSON.stringify(handoff.facts, null, 2)}\n`;
    const incomingFactsHash = sha256(incomingFactsJson);

    // 判定顺序：内容一致 → 幂等跳过；内容不同 → 冲突（不覆盖，落 incoming）。
    // 不再「只看台账命中就跳过」——那样会掩盖用户对目标的手工修改。
    let finalDir = targetDir;
    let conflict = false;
    let skipped = false;
    if (await exists(targetDir)) {
        const existingFacts = path.join(targetDir, "product-facts.json");
        if (await exists(existingFacts)) {
            const existingHash = await fileSha256(existingFacts);
            if (existingHash === incomingFactsHash) {
                skipped = true;
            }
            else {
                conflict = true;
                finalDir = `${targetDir}.incoming-${Date.now()}`;
            }
        }
        else {
            conflict = true;
            finalDir = `${targetDir}.incoming-${Date.now()}`;
        }
    }

    if (dryRun) {
        return { status: skipped ? "SKIPPED" : conflict ? "CONFLICT" : "IMPORTED", targetDir: finalDir, dryRun: true };
    }
    if (skipped) {
        return { status: "SKIPPED", targetDir, reason: "idempotent：目标已存在且内容一致" };
    }

    await mkdir(path.join(finalDir, "产品图"), { recursive: true });
    await mkdir(path.join(finalDir, "output"), { recursive: true });

    // 1) facts + 交接清单
    await writeFile(path.join(finalDir, "product-facts.json"), incomingFactsJson, "utf8");
    const manifest = {
        handoffId: handoff.handoffId,
        operationId: handoff.operationId,
        direction: handoff.direction,
        productId: handoff.productId,
        source: "ecom-translator",
        status: conflict ? "CONFLICT" : "IMPORTED",
        artifacts: handoff.artifacts,
        provenance: handoff.provenance,
        importedAt: new Date().toISOString()
    };
    await writeFile(path.join(finalDir, "ecom-handoff.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    // 2) 图片：source → 产品图/，translated → output/
    for (const artifact of handoff.artifacts) {
        const src = path.join(handoff.productDir, artifact.name);
        if (!(await exists(src))) continue;
        if (artifact.kind === "source") {
            await copyFile(src, path.join(finalDir, "产品图", artifact.name));
        }
        else if (artifact.kind === "translated") {
            await copyFile(src, path.join(finalDir, "output", artifact.name));
        }
        else if (artifact.kind === "listing") {
            await copyFile(src, path.join(finalDir, "output", artifact.name));
        }
    }

    await appendLedger(ledgerPath, {
        operationId: handoff.operationId,
        handoffId: handoff.handoffId,
        productId: handoff.productId,
        targetDir: finalDir,
        status: conflict ? "CONFLICT" : "IMPORTED",
        importedAt: new Date().toISOString()
    });

    return {
        status: conflict ? "CONFLICT" : "IMPORTED",
        targetDir: finalDir,
        reason: conflict ? "目标已存在且内容不同，已落 incoming 待人工裁决" : undefined
    };
}

/** 探测 ecom 控制台是否在运行（GET /api/service）。 */
export async function probeEcomService(baseUrl = "http://127.0.0.1:8765", timeoutMs = 1500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(new URL("/api/service", baseUrl), { signal: controller.signal });
        return { alive: response.ok, status: response.status };
    }
    catch {
        return { alive: false, status: 0 };
    }
    finally {
        clearTimeout(timer);
    }
}
