import { mkdir, readFile, writeFile } from "node:fs/promises";
import { LISTING_CONTENT_PROMPT_FILE, INSERT_LISTING_CONTENT_PROMPT_FILE, INSERT_PROMPT_FILE, INSERT_MARKET_RADAR_PROMPT_FILE, MARKET_VISUAL_AUDIT_PROMPT_V2, MARKET_VISUAL_AUDIT_V2_PROMPT_FILE, PLANNING_PROMPT_FILE, PROMPTS_DIR, SINGLE_IMAGE_PROMPT_GENERATOR_V2, SINGLE_IMAGE_PROMPT_V2_FILE, VISUAL_PLANNING_PROMPT_V2, VISUAL_PLANNING_V2_PROMPT_FILE, VISUAL_STRATEGY_COMPRESSION_PROMPT_FILE, VISUAL_STRATEGY_COMPRESSION_PROMPT_V1, RESEARCH_PROMPT_FILE, SEO_KEYWORDS_PROMPT_FILE, SELECTION_PROMPT_FILE } from "./config.js";
export const PROMPT_KINDS = [
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
    "productSelection"
];
function promptPath(kind) {
    const paths = {
        research: RESEARCH_PROMPT_FILE,
        planning: PLANNING_PROMPT_FILE,
        seoKeywords: SEO_KEYWORDS_PROMPT_FILE,
        listingContent: LISTING_CONTENT_PROMPT_FILE,
        luxuryInsert: INSERT_PROMPT_FILE,
        insertMarketRadar: INSERT_MARKET_RADAR_PROMPT_FILE,
        insertListingContent: INSERT_LISTING_CONTENT_PROMPT_FILE,
        marketVisualAuditV2: MARKET_VISUAL_AUDIT_V2_PROMPT_FILE,
        visualStrategyCompression: VISUAL_STRATEGY_COMPRESSION_PROMPT_FILE,
        visualPlanningV2: VISUAL_PLANNING_V2_PROMPT_FILE,
        singleImagePromptV2: SINGLE_IMAGE_PROMPT_V2_FILE,
        productSelection: SELECTION_PROMPT_FILE
    };
    return paths[kind];
}
function promptFallback(kind) {
    const fallbacks = {
        marketVisualAuditV2: MARKET_VISUAL_AUDIT_PROMPT_V2,
        visualStrategyCompression: VISUAL_STRATEGY_COMPRESSION_PROMPT_V1,
        visualPlanningV2: VISUAL_PLANNING_PROMPT_V2,
        singleImagePromptV2: SINGLE_IMAGE_PROMPT_GENERATOR_V2
    };
    return fallbacks[kind];
}
function promptLabel(kind) {
    const labels = {
        research: "市场调研",
        planning: "视觉规划",
        seoKeywords: "SEO 关键词",
        listingContent: "Listing 文案",
        luxuryInsert: "奢侈包内胆 7 图",
        insertMarketRadar: "内胆每日市场选款",
        insertListingContent: "内胆 Listing 文案",
        marketVisualAuditV2: "市场视觉调研 v2",
        visualStrategyCompression: "视觉策略裁剪",
        visualPlanningV2: "视觉规划 v2",
        singleImagePromptV2: "单图 Prompt v2",
        productSelection: "选品研究 Bob"
    };
    return labels[kind];
}
export async function readPrompt(kind) {
    let content = "";
    try {
        content = (await readFile(promptPath(kind), "utf8")).trim();
    }
    catch {
        content = (promptFallback(kind) || "").trim();
    }
    if (!content) {
        throw new Error(`${promptLabel(kind)} Prompt 为空`);
    }
    return content;
}
export async function savePrompt(kind, content) {
    const normalized = content.trim();
    if (!normalized)
        throw new Error("Prompt 内容不能为空");
    await mkdir(PROMPTS_DIR, { recursive: true });
    await writeFile(promptPath(kind), `${normalized}\n`, "utf8");
}
export async function promptStatus() {
    const status = async (kind) => {
        try {
            const content = await readPrompt(kind);
            return { ready: true, characters: content.length };
        }
        catch {
            return { ready: false, characters: 0 };
        }
    };
    return {
        ...Object.fromEntries(await Promise.all(PROMPT_KINDS.map(async (kind) => [kind, await status(kind)])))
    };
}
export function validatePromptPack(text) {
    return validateNumberedPromptPack(text, 10);
}
export function validateNumberedPromptPack(text, count) {
    const missing = [];
    for (let index = 1; index <= count; index += 1) {
        const number = String(index).padStart(2, "0");
        for (const boundary of ["START", "END"]) {
            const marker = `<<<IMAGE_${number}_PROMPT_${boundary}>>>`;
            if (!text.includes(marker))
                missing.push(marker);
        }
    }
    return { valid: missing.length === 0, missing };
}
export function extractImagePrompt(text, imageNumber) {
    return extractNumberedImagePrompt(text, imageNumber, 10);
}
export function validateSingleImagePromptV2(text) {
    const errors = [];
    const startCount = (text.match(/<<<IMAGE_PROMPT_START>>>/g) || []).length;
    const endCount = (text.match(/<<<IMAGE_PROMPT_END>>>/g) || []).length;
    if (startCount !== 1)
        errors.push("Single Image Prompt v2 must contain exactly one IMAGE_PROMPT_START marker");
    if (endCount !== 1)
        errors.push("Single Image Prompt v2 must contain exactly one IMAGE_PROMPT_END marker");
    if (/<<<IMAGE_\d{2}_PROMPT_START>>>/.test(text) || /<<<IMAGE_\d{2}_PROMPT_END>>>/.test(text)) {
        errors.push("Single Image Prompt v2 must not contain numbered prompt pack markers");
    }
    return { valid: errors.length === 0, errors };
}
export function extractNumberedImagePrompt(text, imageNumber, count) {
    if (!Number.isInteger(imageNumber) || imageNumber < 1 || imageNumber > count) {
        throw new Error(`Image 编号必须在 1–${count} 之间`);
    }
    const number = String(imageNumber).padStart(2, "0");
    const start = `<<<IMAGE_${number}_PROMPT_START>>>`;
    const end = `<<<IMAGE_${number}_PROMPT_END>>>`;
    const startIndex = text.indexOf(start);
    const endIndex = text.indexOf(end, startIndex + start.length);
    if (startIndex === -1 || endIndex === -1) {
        throw new Error(`无法提取 Image ${imageNumber} Prompt`);
    }
    const prompt = text.slice(startIndex + start.length, endIndex).trim();
    if (!prompt)
        throw new Error(`Image ${imageNumber} Prompt 为空`);
    return prompt;
}
//# sourceMappingURL=prompt-files.js.map