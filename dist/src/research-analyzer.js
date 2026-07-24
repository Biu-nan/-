// 爆款研究中心 · 拆解引擎
// 职责：把爆款图（本地路径）+ 结构化 metrics 喂给 ChatGPT 多模态，解析出 HitReport。
// 复用 chatgpt-adapter 的 launch / createBlankChat / uploadImages / sendPromptOnce /
// waitForResponseAfterPrompt（与现有 fact-extract 同套范式）。
import { readFile } from "node:fs/promises";
import { jsonrepair } from "jsonrepair";
import {
    HOT_PRODUCT_TEARDOWN_PROMPT_FILE,
    HOT_PRODUCT_TEARDOWN_FINGERPRINT
} from "./config.js";

// 从 ChatGPT 回复中抽取 HitReport JSON。优先固定边界，其次 ```json 代码块，再次整段容错。
export function extractHitReport(text) {
    if (!text) throw new Error("ChatGPT 未返回任何内容");
    const boundary = text.match(
        /<<<HIT_REPORT_START>>>([\s\S]*?)<<<HIT_REPORT_END>>>/i
    );
    let raw = boundary ? boundary[1] : null;
    if (!raw) {
        const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        raw = codeBlock ? codeBlock[1] : text;
    }
    raw = raw.trim();
    try {
        return JSON.parse(jsonrepair(raw));
    }
    catch (err) {
        throw new Error(`爆款拆解结果解析失败：${err.message}；原始片段：${raw.slice(0, 200)}`);
    }
}

// 轻量校验 + 兜底，避免前端拿到残缺结构。
function normalizeReport(report) {
    const out = {
        summary: report.summary || "",
        categoryBenchmark: report.categoryBenchmark || {},
        hitFactors: Array.isArray(report.hitFactors) ? report.hitFactors : [],
        recommendations: Array.isArray(report.recommendations) ? report.recommendations : []
    };
    out.hitFactors = out.hitFactors
        .map((f, i) => ({
            id: f.id || `f${i + 1}`,
            dimension: ["visual", "data", "content", "price", "review"].includes(f.dimension)
                ? f.dimension
                : "visual",
            name: f.name || "未命名因子",
            evidence: {
                images: Array.isArray(f.evidence?.images) ? f.evidence.images : [],
                metrics: Array.isArray(f.evidence?.metrics) ? f.evidence.metrics : []
            },
            weight: Math.min(5, Math.max(1, Number(f.weight) || 3)),
            replicability: ["copy", "adapt", "reference"].includes(f.replicability)
                ? f.replicability
                : "reference",
            note: f.note || ""
        }))
        .sort((a, b) => b.weight - a.weight);
    return out;
}

export async function analyzeHotProduct(chatgpt, { imagePaths = [], identity = {}, metrics = {} }) {
    const template = await readFile(HOT_PRODUCT_TEARDOWN_PROMPT_FILE, "utf8");
    const metricsBlock = JSON.stringify({ identity, metrics }, null, 2);
    const prompt = [
        template,
        "",
        "<<<METRICS_START>>>",
        metricsBlock,
        "<<<METRICS_END>>>",
        "",
        HOT_PRODUCT_TEARDOWN_FINGERPRINT
    ].join("\n");

    await chatgpt.launch();
    await chatgpt.createBlankChat();
    if (imagePaths.length) {
        await chatgpt.uploadImages(imagePaths);
    }
    await chatgpt.sendPromptOnce(prompt, HOT_PRODUCT_TEARDOWN_FINGERPRINT);
    const reply = await chatgpt.waitForResponseAfterPrompt(HOT_PRODUCT_TEARDOWN_FINGERPRINT);
    const report = normalizeReport(extractHitReport(reply));
    return report;
}
