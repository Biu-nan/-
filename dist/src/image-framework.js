// 10 图作图框架校验器（v1.0 标准的代码级兜底）
// 目的：解析视觉规划文本，断言「10 槽互异 + 第 3 槽 = 尺寸/比例 + 使用场景 ≤ 2」，
// 防止模型偶尔跑偏（例如又生成 5 张挂包图、缺尺寸图）。不过则调用方判 FAILED。
//
// 说明：模型输出格式有波动，这里按「图片标题」解析（Image 01｜Hero 主图 / | Image 01 | Hero Hook |），
// 分类采用关键词启发式；宁可漏判也不误杀时，可把 scene>2 降级为 warning（当前按用户要求为 critical）。

const SIZE_RE = /尺寸|比例|\bsize\b|dimension|\bscale\b/i;
const HERO_RE = /hero|主图|全身|portrait|front view/i;
const SCENE_RE = /场景|\bscene\b|lifestyle|搭配|styling|通勤|日常|斜挎/i;
const MATERIAL_RE = /材质|做工|\btexture\b|\bmaterial\b|光泽|质感/i;
const USAGE_RE = /使用方式|怎么用|如何用|how it (works|hangs|clips)|usage|\bdemo\b|开合|挂扣|挂上/i;
const PACKAGE_RE = /包装|礼赠|清单|配件|收到什么|what'?s in|package|gift|included|accessor/i;
const INFO_RE = /信息图|infographic|at a glance|对比|compare/i;
const TRUST_RE = /信任|多角度|trust|summary|角度|final/i;

/** 从规划文本中提取 10 个槽位标题（同一编号取首次出现）。 */
export function parseImageSlots(text) {
    const slots = [];
    const seen = new Set();
    const re = /Image\s*0?(\d{1,2})\s*[｜|]\s*([^｜|\n]{1,60})/g;
    let m;
    while ((m = re.exec(text || "")) !== null) {
        const num = Number(m[1]);
        const name = String(m[2] || "").trim();
        if (num < 1 || num > 10 || !name || seen.has(num)) {
            continue;
        }
        seen.add(num);
        slots.push({ num, name });
    }
    return slots.sort((a, b) => a.num - b.num);
}

export function classifySlot(name) {
    const t = String(name || "");
    if (SIZE_RE.test(t)) return "size";
    if (HERO_RE.test(t)) return "hero";
    if (SCENE_RE.test(t)) return "scene";
    if (MATERIAL_RE.test(t)) return "material";
    if (USAGE_RE.test(t)) return "usage";
    if (PACKAGE_RE.test(t)) return "package";
    if (INFO_RE.test(t)) return "infographic";
    if (TRUST_RE.test(t)) return "trust";
    return "other";
}

/**
 * 校验 10 图框架。
 * @returns {{ ok:boolean, critical:boolean, violations:string[], warnings:string[],
 *             slots:Array<{num:number,name:string,job:string}>, slotCount:number,
 *             sceneCount:number, portraitCount:number, slot3Job:string }}
 */
export function validateImageFramework(text) {
    const slots = parseImageSlots(text).map((s) => ({ ...s, job: classifySlot(s.name) }));
    const violations = [];
    const warnings = [];

    if (slots.length !== 10) {
        violations.push(`槽位标题 ${slots.length} 个（期望 10）`);
    }

    const slot3 = slots.find((s) => s.num === 3);
    const slot3Job = slot3 ? slot3.job : "missing";
    if (!slot3) {
        violations.push("缺少第 3 槽（尺寸/比例）");
    }
    else if (slot3.job !== "size") {
        violations.push(`第 3 槽不是尺寸/比例（实际：${slot3.name}）`);
    }

    const norm = (v) => String(v || "").replace(/\s+/g, "").toLowerCase();
    const nameCount = new Map();
    for (const s of slots) {
        const key = norm(s.name);
        nameCount.set(key, (nameCount.get(key) || 0) + 1);
    }
    const dup = [...nameCount.entries()].filter(([, c]) => c > 1).map(([k]) => k);
    if (dup.length) {
        violations.push(`槽位名称重复：${dup.join("、")}`);
    }

    const sceneCount = slots.filter((s) => s.job === "scene").length;
    const portraitCount = slots.filter((s) => s.job === "hero" || s.job === "trust").length;
    if (sceneCount > 2) {
        violations.push(`使用场景槽 ${sceneCount} 个（要求 ≤ 2）`);
    }
    if (portraitCount > 2) {
        warnings.push(`全身/肖像类槽 ${portraitCount} 个（要求 ≤ 2，建议检查）`);
    }

    return {
        ok: violations.length === 0,
        critical: violations.length > 0,
        violations,
        warnings,
        slots,
        slotCount: slots.length,
        sceneCount,
        portraitCount,
        slot3Job
    };
}
