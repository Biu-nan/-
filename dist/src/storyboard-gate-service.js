import { extractImagePrompt, validatePromptPack } from "./prompt-files.js";
const EXPECTED_ROLES = [
    "hero_hook",
    "pain_point",
    "core_feature",
    "material_detail",
    "use_demo",
    "benefit_infographic",
    "gift_or_variant",
    "lifestyle_scene",
    "emotional_scene",
    "trust_summary"
];
const DEFAULT_BUYER_QUESTIONS = [
    "What is this product and why should I notice it?",
    "Why is this better than an ordinary gift?",
    "What real feature proves the claim?",
    "What material or detail can I trust?",
    "How does the product work in real use?",
    "What quick benefit should I remember?",
    "Is it suitable as a gift or variant choice?",
    "How does it fit into daily life?",
    "What emotional value does it create?",
    "What final reasons support purchase?"
];
const DEFAULT_FUNNEL_STAGES = [
    "attention",
    "interest",
    "proof",
    "proof",
    "usage",
    "comparison",
    "desire",
    "usage",
    "desire",
    "decision"
];
const FORBIDDEN_MULTI_IMAGE_TERMS = [
    "collage",
    "grid",
    "contact sheet",
    "storyboard",
    "multiple images",
    "multi-panel",
    "split screen",
    "image 1-10",
    "image 01-10"
];
function normalizeSemantic(value) {
    return value
        .toLowerCase()
        .replace(/[`"'“”‘’.,，。:：;；!！?？()[\]{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function readField(text, labels) {
    for (const label of labels) {
        const pattern = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:${label})\\s*[:：]\\s*(.+)`, "i");
        const match = text.match(pattern);
        if (match?.[1])
            return match[1].trim();
    }
    return "";
}
function extractMarkedJson(text, start, end) {
    const startIndex = text.indexOf(start);
    const endIndex = text.indexOf(end, startIndex + start.length);
    if (startIndex === -1 || endIndex === -1) {
        throw new Error(`缺少 JSON 边界标记：${start} / ${end}`);
    }
    const raw = text.slice(startIndex + start.length, endIndex).trim();
    if (!raw)
        throw new Error(`JSON 边界内容为空：${start}`);
    return JSON.parse(raw);
}
function normalizeQcIssue(issue) {
    if (typeof issue === "string")
        return issue;
    if (!issue || typeof issue !== "object")
        return String(issue);
    const record = issue;
    const parts = [
        record.type,
        Array.isArray(record.image_numbers)
            ? `Image ${record.image_numbers.join(", ")}`
            : record.image_number
                ? `Image ${record.image_number}`
                : undefined,
        record.field,
        record.issue || record.message || record.reason
    ]
        .filter((part) => typeof part === "string" && part.trim().length > 0)
        .map((part) => part.trim());
    return parts.length ? parts.join(" | ") : JSON.stringify(issue);
}
function normalizeQcIssues(issues) {
    if (!Array.isArray(issues))
        return [];
    return issues.map(normalizeQcIssue);
}
export function normalizeGenerationQcResult(result) {
    if (!result || typeof result !== "object")
        return undefined;
    const record = result;
    return {
        valid: Boolean(record.valid),
        image_number: typeof record.image_number === "string" ? record.image_number : undefined,
        qc_status: record.qc_status || (record.valid ? "pass" : "failed"),
        errors: normalizeQcIssues(record.errors),
        warnings: normalizeQcIssues(record.warnings),
        block_next_images: Boolean(record.block_next_images),
        regenerate_required: Boolean(record.regenerate_required)
    };
}
function roleFromPrompt(prompt, index) {
    const role = normalizeSemantic(readField(prompt, ["Image Role", "Funnel Stage"]) || prompt);
    if (role.includes("hero"))
        return "hero_hook";
    if (role.includes("pain"))
        return "pain_point";
    if (role.includes("feature"))
        return "core_feature";
    if (role.includes("material") || role.includes("texture") || role.includes("detail"))
        return "material_detail";
    if (role.includes("use demo") || role.includes("how it works"))
        return "use_demo";
    if (role.includes("infographic") || role.includes("benefit"))
        return "benefit_infographic";
    if (role.includes("gift") || role.includes("variant") || role.includes("package"))
        return "gift_or_variant";
    if (role.includes("emotional"))
        return "emotional_scene";
    if (role.includes("lifestyle"))
        return index === 8 ? "lifestyle_scene" : "emotional_scene";
    if (role.includes("trust") || role.includes("summary"))
        return "trust_summary";
    return EXPECTED_ROLES[index - 1];
}
function coerceFunnelStage(value, index) {
    const normalized = normalizeSemantic(value);
    for (const stage of ["attention", "interest", "proof", "comparison", "usage", "desire", "trust", "decision"]) {
        if (normalized.includes(stage))
            return stage;
    }
    return DEFAULT_FUNNEL_STAGES[index - 1];
}
function duplicateValues(items, field) {
    const seen = new Map();
    for (const item of items) {
        const value = normalizeSemantic(String(item[field] || ""));
        if (!value)
            continue;
        const list = seen.get(value) || [];
        list.push(item.image_number);
        seen.set(value, list);
    }
    return [...seen.entries()]
        .filter(([, numbers]) => numbers.length > 1)
        .map(([value, numbers]) => `${String(field)} duplicated for ${numbers.join(", ")}: ${value}`);
}
export function validateStoryboardGate(gate) {
    const errors = [];
    const warnings = [];
    if (gate.items.length !== 10)
        errors.push("storyboard must contain exactly 10 items");
    const expectedNumbers = Array.from({ length: 10 }, (_, index) => String(index + 1).padStart(2, "0"));
    const actualNumbers = gate.items.map((item) => item.image_number);
    for (const number of expectedNumbers) {
        if (!actualNumbers.includes(number))
            errors.push(`missing storyboard image ${number}`);
    }
    gate.items.forEach((item, index) => {
        if (!item.buyer_question.trim())
            errors.push(`Image ${item.image_number} missing buyer_question`);
        if (!item.core_selling_point.trim())
            errors.push(`Image ${item.image_number} missing core_selling_point`);
        if (!item.visual_proof.trim())
            errors.push(`Image ${item.image_number} missing visual_proof`);
        if (!item.headline.trim())
            errors.push(`Image ${item.image_number} missing headline`);
        if (item.image_role !== EXPECTED_ROLES[index]) {
            warnings.push(`Image ${item.image_number} role ${item.image_role} differs from expected ${EXPECTED_ROLES[index]}`);
        }
    });
    errors.push(...duplicateValues(gate.items, "image_role"));
    errors.push(...duplicateValues(gate.items, "buyer_question"));
    errors.push(...duplicateValues(gate.items, "core_selling_point"));
    errors.push(...duplicateValues(gate.items, "visual_proof"));
    errors.push(...duplicateValues(gate.items, "headline"));
    return {
        valid: errors.length === 0,
        qc_status: errors.length === 0 ? "pass" : "failed",
        errors,
        warnings,
        block_next_images: errors.length > 0,
        regenerate_required: false
    };
}
export function validatePreGenerationPrompt(prompt, item, generatedImageNumbers = []) {
    const errors = [];
    const warnings = [];
    const normalized = normalizeSemantic(prompt);
    for (const term of FORBIDDEN_MULTI_IMAGE_TERMS) {
        if (normalized.includes(term))
            errors.push(`Image ${item.image_number} contains forbidden multi-image term: ${term}`);
    }
    for (let number = 1; number <= 10; number += 1) {
        const padded = String(number).padStart(2, "0");
        if (padded === item.image_number)
            continue;
        const otherPattern = new RegExp(`\\bimage\\s*0?${number}\\b`, "i");
        if (otherPattern.test(prompt))
            errors.push(`Image ${item.image_number} references other image number: ${padded}`);
    }
    if (!normalizeSemantic(prompt).includes(normalizeSemantic(item.core_selling_point).slice(0, 18))) {
        warnings.push(`Image ${item.image_number} prompt may not clearly include its storyboard core selling point`);
    }
    if (!normalizeSemantic(prompt).includes(normalizeSemantic(item.visual_proof).slice(0, 18))) {
        warnings.push(`Image ${item.image_number} prompt may not clearly include its storyboard visual proof`);
    }
    if (generatedImageNumbers.includes(Number(item.image_number))) {
        errors.push(`Image ${item.image_number} has already been generated`);
    }
    return {
        valid: errors.length === 0,
        image_number: item.image_number,
        qc_status: errors.length === 0 ? "pass" : "failed",
        errors,
        warnings,
        block_next_images: errors.length > 0,
        regenerate_required: errors.length > 0
    };
}
export function validatePromptPackAgainstStoryboard(promptPack, gate) {
    const markerValidation = validatePromptPack(promptPack);
    const errors = markerValidation.missing.map((marker) => `missing prompt marker: ${marker}`);
    const warnings = [];
    if (markerValidation.valid) {
        for (const item of gate.items) {
            const prompt = extractImagePrompt(promptPack, Number(item.image_number));
            const promptCoreSellingPoint = readField(prompt, ["Core Selling Point", "Core Selling Point:", "对应卖点"]);
            const promptVisualProof = readField(prompt, ["Visual Proof", "Visual Composition", "Product Placement", "可视化物理特征"]);
            const promptHeadline = readField(prompt, ["English Copy on Image", "Headline", "标题"]);
            if (promptCoreSellingPoint && normalizeSemantic(promptCoreSellingPoint) !== normalizeSemantic(item.core_selling_point)) {
                errors.push(`Image ${item.image_number} core_selling_point does not match storyboard`);
            }
            if (promptVisualProof && normalizeSemantic(promptVisualProof) !== normalizeSemantic(item.visual_proof)) {
                errors.push(`Image ${item.image_number} visual_proof does not match storyboard`);
            }
            if (promptHeadline && normalizeSemantic(promptHeadline) !== normalizeSemantic(item.headline)) {
                errors.push(`Image ${item.image_number} headline does not match storyboard`);
            }
            const validation = validatePreGenerationPrompt(prompt, item);
            errors.push(...validation.errors);
            warnings.push(...validation.warnings);
        }
    }
    return {
        valid: errors.length === 0,
        qc_status: errors.length === 0 ? "pass" : "failed",
        errors,
        warnings,
        block_next_images: errors.length > 0,
        regenerate_required: false
    };
}
export function createTechnicalPostGenerationQc(input) {
    const imageNumber = String(input.imageNumber).padStart(2, "0");
    if (!input.fileSaved) {
        return {
            valid: false,
            image_number: imageNumber,
            qc_status: "failed",
            errors: [`Image ${imageNumber} output file was not saved`],
            warnings: [],
            block_next_images: true,
            regenerate_required: true
        };
    }
    return {
        valid: true,
        image_number: imageNumber,
        qc_status: "needs_manual_qc",
        errors: [],
        warnings: [
            `Image ${imageNumber} technical save passed; manual visual QC still required for product mismatch, text errors, duplicate composition and SKU contamination.`
        ],
        block_next_images: false,
        regenerate_required: false
    };
}
export class StoryboardGateService {
    parseStoryboardGate(text) {
        const gate = extractMarkedJson(text, "<<<STORYBOARD_GATE_JSON_START>>>", "<<<STORYBOARD_GATE_JSON_END>>>");
        const validation = validateStoryboardGate(gate);
        return {
            ...gate,
            qc_summary: {
                ...gate.qc_summary,
                duplicate_count: validation.errors.filter((error) => error.includes("duplicated")).length,
                missing_buyer_questions: gate.items.filter((item) => !item.buyer_question.trim()).map((item) => item.image_number),
                missing_visual_proof: gate.items.filter((item) => !item.visual_proof.trim()).map((item) => item.image_number),
                sequence_status: validation.errors.some((error) => error.includes("missing storyboard image")) ? "failed" : "pass",
                can_generate_prompt_pack: validation.valid,
                errors: validation.errors,
                warnings: validation.warnings
            },
            items: gate.items.map((item) => ({
                ...item,
                qc_status: validation.valid ? "pass" : "needs_revision"
            }))
        };
    }
    parseStoryboardQc(text) {
        const result = extractMarkedJson(text, "<<<STORYBOARD_QC_JSON_START>>>", "<<<STORYBOARD_QC_JSON_END>>>");
        return normalizeGenerationQcResult(result);
    }
    buildFromPromptPack(input) {
        const items = [];
        for (let index = 1; index <= 10; index += 1) {
            const prompt = extractImagePrompt(input.planningText, index);
            const imageNumber = String(index).padStart(2, "0");
            const coreSellingPoint = readField(prompt, ["Core Selling Point", "对应卖点"]) ||
                readField(prompt, ["Final Image Generation Prompt"]).slice(0, 120);
            const visualProof = readField(prompt, ["Visual Proof", "Visual Composition", "Product Placement", "可视化物理特征"]) ||
                readField(prompt, ["Final Image Generation Prompt"]).slice(0, 120);
            const headline = readField(prompt, ["English Copy on Image", "Headline", "标题"]) ||
                `Image ${imageNumber}`;
            const item = {
                image_number: imageNumber,
                image_role: roleFromPrompt(prompt, index),
                buyer_question: readField(prompt, ["Buyer Question", "Buyer Psychology"]) ||
                    DEFAULT_BUYER_QUESTIONS[index - 1],
                funnel_stage: coerceFunnelStage(readField(prompt, ["Funnel Stage"]), index),
                core_selling_point: coreSellingPoint,
                visual_proof: visualProof,
                headline,
                must_show: [visualProof].filter(Boolean),
                must_not_show: [
                    "product mismatch",
                    "multiple unrelated products",
                    "extra product structures",
                    "collage",
                    "grid"
                ],
                duplicate_check_against: {
                    image_numbers: Array.from({ length: index - 1 }, (_, prior) => String(prior + 1).padStart(2, "0")),
                    fields: ["image_role", "buyer_question", "core_selling_point", "visual_proof", "headline", "composition"]
                },
                sequence_reason: `Image ${imageNumber} follows the ${EXPECTED_ROLES[index - 1]} step in the buyer decision path.`,
                qc_status: "draft"
            };
            items.push(item);
        }
        const gate = {
            product_id: input.productId,
            prompt_version: input.promptVersion ?? "storyboard-gate-v0.1",
            storyboard_version: "v0.1",
            items,
            qc_summary: {
                duplicate_count: 0,
                missing_buyer_questions: [],
                missing_visual_proof: [],
                sequence_status: "pass",
                can_generate_prompt_pack: false,
                errors: [],
                warnings: []
            }
        };
        const validation = validateStoryboardGate(gate);
        gate.qc_summary = {
            duplicate_count: validation.errors.filter((error) => error.includes("duplicated")).length,
            missing_buyer_questions: items.filter((item) => !item.buyer_question.trim()).map((item) => item.image_number),
            missing_visual_proof: items.filter((item) => !item.visual_proof.trim()).map((item) => item.image_number),
            sequence_status: validation.errors.some((error) => error.includes("missing storyboard image")) ? "failed" : "pass",
            can_generate_prompt_pack: validation.valid,
            errors: validation.errors,
            warnings: validation.warnings
        };
        gate.items = gate.items.map((item) => ({
            ...item,
            qc_status: validation.valid ? "pass" : "needs_revision"
        }));
        return gate;
    }
}
//# sourceMappingURL=storyboard-gate-service.js.map