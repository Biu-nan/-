// 爆款研究中心 · 存储层
// 职责：读写 data/hot-products.json（爆款记录集合），落盘走 json-write-queue 防并发损坏。
// 不依赖 server，可单测。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { enqueueFileWrite } from "./json-write-queue.js";
import { HOT_PRODUCTS_FILE } from "./config.js";

const EMPTY = { schemaVersion: "1.0", products: [] };

async function readAll() {
    try {
        const raw = await readFile(HOT_PRODUCTS_FILE, "utf8");
        if (!raw.trim()) return { ...EMPTY };
        const data = JSON.parse(raw);
        return {
            schemaVersion: data.schemaVersion || "1.0",
            products: Array.isArray(data.products) ? data.products : []
        };
    }
    catch {
        return { ...EMPTY };
    }
}

async function writeAll(data) {
    await mkdir(path.dirname(HOT_PRODUCTS_FILE), { recursive: true });
    await enqueueFileWrite(HOT_PRODUCTS_FILE, () =>
        writeFile(HOT_PRODUCTS_FILE, JSON.stringify(data, null, 2), "utf8"));
}

export const ResearchStore = {
    async list() {
        const all = await readAll();
        return all.products
            .slice()
            .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    },
    async get(id) {
        const all = await readAll();
        return all.products.find((p) => p.id === id) || null;
    },
    async create(record) {
        const all = await readAll();
        all.products.push(record);
        await writeAll(all);
        return record;
    },
    async update(id, patch) {
        const all = await readAll();
        const idx = all.products.findIndex((p) => p.id === id);
        if (idx < 0) return null;
        all.products[idx] = { ...all.products[idx], ...patch, id };
        await writeAll(all);
        return all.products[idx];
    },
    async remove(id) {
        const all = await readAll();
        const next = all.products.filter((p) => p.id !== id);
        if (next.length === all.products.length) return false;
        await writeAll({ ...all, products: next });
        return true;
    }
};

export function newHotProductId() {
    return `hp_${randomUUID().slice(0, 8)}`;
}

export function emptyRecord(id) {
    const now = new Date().toISOString();
    return {
        schemaVersion: "1.0",
        id,
        sourcePlatform: "",
        sourceUrl: "",
        category: "",
        identity: { title: "", brand: "", price: null, currency: "", captureDate: now, thumbAssetId: null },
        metrics: {
            salesVolume: null,
            salesRank: null,
            rating: null,
            reviewCount: null,
            wishlistCount: null,
            price: null,
            currency: "",
            capturedAt: null
        },
        images: { analysis: [] },
        analysis: null,
        status: "imported",
        error: null,
        createdAt: now,
        updatedAt: now
    };
}
