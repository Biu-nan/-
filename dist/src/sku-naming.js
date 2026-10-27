// 变体命名：中文款式名 → 店小秘可接受英文短名（≤20 字符）
//
// 移植自 D:\ecom-translator\src\erp_planner.py:
//   _sku_colors:354 / _sku_source_code:376 / _fit_sku_name:391 / _pick_theme_words:415
//   _sku_custom_name:688-870
// 词表外置到 config/color-theme-dictionary.json（49 色 / 280 主题 / 6 金属色），
// 由一跨与 ecom 共用同一份 —— 两份表必然漂移，这是 ecom 自己在注释里写过的教训。
//
// 移植时**刻意保留**的四个分支顺序（每条都由真实事故反推，改顺序会静默塌名）：
//   ① 已合规英文名直接沿用；
//   ② 「颜色 + 包装词」候选只算不早返回（O-077：早返回让 `小猫古金小挂件` /
//      `小恐龙金小挂件` 四条全塌成 `Gold Bag Charm`，284 个真实源名里 28 个受影响）；
//   ③ 主题词命中后，若源名还有 ≥2 字剩余，带上款式编号（C72 与 B51 的源名完全相同，
//      编号是唯一区分符）；
//   ④ 兜底前先剥编号与标点再试一轮（`Q103-1，挂饰款（带扣子）` 这类必落空）。
//
// 与 ecom 的差异只有一处：ecom 返回 `(name, source, needs_review)` 三元组，
// 这里返回对象；判定逻辑逐字保持。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DICTIONARY = path.join(HERE, "..", "..", "config", "color-theme-dictionary.json");

/** 店小秘自定义名允许的字符集与上限（20 字符，实测）。 */
export const CUSTOM_NAME_LIMIT = 20;
const ENGLISH_SAFE = /^[A-Za-z0-9 .,()&+\-_/]{1,20}$/;
const CODE_RE = /^\s*([A-Za-z]{1,4}\d{1,4}(?:-\d+)?)/;
const CODE_CN_RE = /^\s*(\d{1,3})\s*号/;
const PACK_RE = /^\s*(\d{1,3})\s*个\s*装\s*$/;
const EDGE_PUNCT = /^[，,、;；:：/＆&()（）[\]【】\-_+]+|[，,、;；:：/＆&()（）[\]【】\-_+]+$/g;

function clean(value, limit = 128) {
    const text = String(value === null || value === undefined ? "" : value).replace(/\s+/g, " ").trim();
    return text.length > limit ? text.slice(0, limit) : text;
}

/** 字符串长度按**字符**算（Python 的 len 语义）。词表里没有增补平面字符，UTF-16 长度等价。 */
function charLength(text) {
    return String(text || "").length;
}

let cachedDictionary = null;

/** 读取共享词表。传 file 可覆盖（测试用）。缺文件时抛错——静默空表会让所有变体退化成 Variant N。 */
export function loadDictionary(file = DEFAULT_DICTIONARY) {
    if (!file && cachedDictionary) return cachedDictionary;
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.colors) || !Array.isArray(parsed.themes)) {
        throw new Error(`词表格式不对（缺 colors/themes 数组）：${file}`);
    }
    if (!file || file === DEFAULT_DICTIONARY) cachedDictionary = parsed;
    return parsed;
}

/**
 * 源款式名里识别到的颜色（最多 2 个，按出现顺序）。
 * 先剔除「金属 / 五金 / 合金」里的「金」——材质不是颜色（实测「金绿」「银玫红」）。
 */
export function skuColors(source, colors) {
    const table = colors || loadDictionary().colors;
    let scan = String(source || "");
    for (const noise of ["金属", "五金", "合金"]) scan = scan.split(noise).join(" ");
    const matched = [];
    for (const entry of [...table].sort((a, b) => b.zh.length - a.zh.length)) {
        const position = scan.indexOf(entry.zh);
        if (position < 0) continue;
        if (!matched.some((item) => item.en === entry.en)) matched.push({ position, en: entry.en });
        scan = scan.split(entry.zh).join(" ".repeat(entry.zh.length));
        if (matched.length === 2) break;
    }
    return matched.sort((a, b) => a.position - b.position).map((item) => item.en);
}

/** 按长度倒序扫主题词表（同长时表内在前的先命中），返回命中的英文条目。 */
export function pickThemeWords(themes, source) {
    const table = themes || loadDictionary().themes;
    let remaining = String(source || "");
    const picked = [];
    for (const entry of [...table].sort((a, b) => b.zh.length - a.zh.length)) {
        if (remaining.includes(entry.zh) && !picked.includes(entry.en)) {
            picked.push(entry.en);
            remaining = remaining.split(entry.zh).join(" ");
        }
    }
    return picked;
}

/** 款式编号：`C72` 原样大写，`13号` → `No.13`（汉字会被店小秘拒绝）。 */
export function sourceCode(source) {
    const text = String(source || "");
    const match = text.match(CODE_RE);
    if (match) return match[1].toUpperCase();
    const cn = text.match(CODE_CN_RE);
    if (cn) return `No.${Number(cn[1])}`;
    return "";
}

/**
 * 20 字符预算内按优先级退化组装：①全主题+区分色 ②首主题+区分色 ③全主题 ④首主题。
 * 按**主题词条目**退化、不按空格切词 —— `Egg Dumpling` 是一条词，按空格切会退成
 * `Egg Silver`，主体词整个丢失（实测饺子包 10 个变体）。
 */
export function fitSkuName(prefix, themeWords, distinguishing) {
    const words = Array.isArray(themeWords) ? themeWords : [];
    const forms = [
        `${prefix}${words.join(" ")} ${distinguishing}`.trim(),
        `${prefix}${words.slice(0, 1).join(" ")} ${distinguishing}`.trim(),
        `${prefix}${words.join(" ")}`.trim(),
        `${prefix}${words.slice(0, 1).join(" ")}`.trim()
    ];
    for (const text of forms) {
        if (text && charLength(text) <= CUSTOM_NAME_LIMIT) return text.trim();
    }
    return forms[0].slice(0, CUSTOM_NAME_LIMIT).trim();
}

/**
 * 主函数：中文款式名 → { value, source, requiresReview }。
 * source 取值与 ecom 一致：`sku_table:SKU名称` / `deterministic_sku_name_translation` /
 * `deterministic_sku_name_fallback`。
 *
 * requiresReview=true 只出现在 `Variant N` 兜底 —— 不假装翻译成功，下游据此进人工复核。
 */
export function customSkuName(value, order = 1, options = {}) {
    const dictionary = options.dictionary || loadDictionary();
    const colorsTable = dictionary.colors;
    const themesTable = dictionary.themes;
    const source = clean(value);

    if (source && ENGLISH_SAFE.test(source)) {
        return { value: source, source: "sku_table:SKU名称", requiresReview: false };
    }

    const colors = skuColors(source, colorsTable);
    const normalized = source.toLowerCase();
    const hasChain = ["链", "挂链", "chain"].some((token) => source.includes(token)) || normalized.includes("chain");
    const hasCharm = ["包", "挂件", "吊坠", "钥匙扣", "keychain", "charm"].some((token) => source.includes(token))
        || ["bag", "charm", "keychain", "pendant"].some((token) => normalized.includes(token));

    // ② 只算不早返回（O-077）
    let colorCharmCandidate = "";
    if (colors.length && (hasChain || hasCharm)) {
        const suffix = hasChain ? "Chain Charm" : "Bag Charm";
        const candidate = `${colors.join(" ")} ${suffix}`;
        if (charLength(candidate) <= CUSTOM_NAME_LIMIT) colorCharmCandidate = candidate;
        else {
            const short = `${colors.join(" ")} Charm`;
            if (charLength(short) <= CUSTOM_NAME_LIMIT) colorCharmCandidate = short;
        }
    }

    const picked = pickThemeWords(themesTable, source);
    // 复算剩余串：用于「主题词之外还有没有别的信息」判定
    let remaining = source;
    for (const entry of [...themesTable].sort((a, b) => b.zh.length - a.zh.length)) {
        if (remaining.includes(entry.zh) && picked.includes(entry.en)) remaining = remaining.split(entry.zh).join(" ");
    }

    if (picked.length) {
        const prefix = source.includes("香肠") ? "Sausage " : "";
        const body = picked.slice(0, 2).join(" ");
        // 只在**恰好一个**颜色时做区分后缀：多个颜色无法判断哪个才是区分特征
        const distinguishing = colors.length === 1 && !picked.includes(colors[0]) ? colors[0] : "";
        let candidate = fitSkuName(prefix, picked.slice(0, 2), distinguishing);
        // ③ 主题词之外仍有信息 → 带款式编号
        const leftover = remaining.replace(/\s+/g, " ").trim().replace(EDGE_PUNCT, "");
        if (charLength(leftover) >= 2) {
            const code = sourceCode(source);
            if (code && !candidate.toUpperCase().startsWith(code.toUpperCase())) {
                const withCode = `${code} ${candidate}`;
                if (charLength(withCode) <= CUSTOM_NAME_LIMIT) candidate = withCode;
                else {
                    const trimmed = fitSkuName(`${code} `, picked.slice(0, 2), distinguishing);
                    candidate = charLength(trimmed) <= CUSTOM_NAME_LIMIT
                        ? trimmed
                        : `${code} ${body}`.slice(0, CUSTOM_NAME_LIMIT).trim();
                }
            }
        }
        if (candidate) return { value: candidate, source: "deterministic_sku_name_translation", requiresReview: false };
    }

    if (colorCharmCandidate) {
        return { value: colorCharmCandidate, source: "deterministic_sku_name_translation", requiresReview: false };
    }

    if (colors.length) {
        const candidate = colors.join(" ").slice(0, CUSTOM_NAME_LIMIT).trim();
        if (candidate) return { value: candidate, source: "deterministic_sku_name_translation", requiresReview: false };
    }

    const pack = source.match(PACK_RE);
    if (pack) {
        const count = Number(pack[1]);
        if (count >= 1 && count <= 999) {
            return { value: `${count} Pcs`, source: "deterministic_sku_name_translation", requiresReview: false };
        }
    }

    // 判据取窄：必须同时出现「定制/打样/来图」与「客服/联系」
    if (/定制|打样|来图/.test(source) && /客服|联系/.test(source)) {
        return { value: "Custom Order", source: "deterministic_sku_name_translation", requiresReview: false };
    }

    // ④ 剥编号与标点后重试（编号保留为前缀）
    const codeMatch = source.match(CODE_RE);
    const skuCode = codeMatch ? codeMatch[1].toUpperCase() : "";
    let scrubbed = source.replace(/[A-Za-z]{1,4}\d{1,4}(?:-\d+)?/g, " ");
    scrubbed = scrubbed.replace(/[，,、;；:：/＆&()（）[\]【】\-_+]+/g, " ");
    scrubbed = scrubbed.replace(/\s+/g, " ").trim();
    if (scrubbed && scrubbed !== source) {
        const scrubbedColors = skuColors(scrubbed, colorsTable);
        let scrubbedRest = scrubbed;
        const scrubbedWords = [];
        for (const entry of [...themesTable].sort((a, b) => b.zh.length - a.zh.length)) {
            if (scrubbedRest.includes(entry.zh) && !scrubbedWords.includes(entry.en)) {
                scrubbedWords.push(entry.en);
                scrubbedRest = scrubbedRest.split(entry.zh).join(" ");
            }
        }
        const bodyWords = scrubbedWords.slice(0, 2).length ? scrubbedWords.slice(0, 2) : scrubbedColors;
        if (bodyWords.length) {
            let body = bodyWords.join(" ");
            if (scrubbedColors.length === 1 && !bodyWords.includes(scrubbedColors[0])) body = `${body} ${scrubbedColors[0]}`;
            let candidate = ((skuCode ? `${skuCode} ` : "") + body).slice(0, CUSTOM_NAME_LIMIT).trim();
            // 保留结尾数字（「水果小挂件7」），否则同款所有序号会撞成同一个名字
            const tail = source.match(/(\d+)\s*$/);
            if (tail && !candidate.includes(tail[1])) {
                const withTail = `${candidate} ${tail[1]}`;
                if (charLength(withTail) <= CUSTOM_NAME_LIMIT) candidate = withTail;
            }
            if (candidate && ENGLISH_SAFE.test(candidate)) {
                return { value: candidate, source: "deterministic_sku_name_translation", requiresReview: false };
            }
        }
    }

    return { value: `Variant ${order}`, source: "deterministic_sku_name_fallback", requiresReview: true };
}

/**
 * 给 sku-table.buildWriteRows 用的命名器工厂。
 * 用法：buildWriteRows(rows, { customNameBuilder: createCustomNameBuilder() })
 */
export function createCustomNameBuilder(options = {}) {
    const dictionary = options.dictionary || loadDictionary();
    return (row, index) => customSkuName(row && row.style, index + 1, { dictionary }).value;
}

/**
 * 包内重名检测：命名后仍有两条同名 → 返回重名清单（不自动加序号）。
 * 与 sku-table.buildWriteRows 的「冲突加 -2」不同：这里只做**门禁**，
 * 让调用方决定是加后缀还是标人工 —— ecom 的取舍是门禁与写入共用同一个消歧函数，
 * 避免"门禁放行、写入却加序号"的平行真相。
 */
export function duplicateNames(writeRows) {
    const count = new Map();
    for (const row of Array.isArray(writeRows) ? writeRows : []) {
        const key = String(row.customName || "").toLowerCase();
        count.set(key, (count.get(key) || 0) + 1);
    }
    return [...count.entries()]
        .filter(([, times]) => times > 1)
        .sort((a, b) => b[1] - a[1])
        .map(([name, times]) => ({ name, times }));
}
