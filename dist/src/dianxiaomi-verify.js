// 店小秘填写准确性原语：写入 → 回读 → 三态判定。
//
// 来源：D:\ecom-translator\tools\dianxiaomi_draft_executor.mjs:337-411（移植 + 一跨特化）。
// 为什么必须有一层统一原语（ecom 的原话）："写入动作与确认动作被分开写，每次都是个案修复
// （改这处、下处照旧）"。实测两次事故（合规主体 / 无线端描述）都一路报 SUCCESS，而页面上
// 根本没填进去。
//
// 本模块**不 import playwright**，也不 import 任何项目模块：全部是纯函数 + 鸭子类型的
// locator 适配器，可以离线单测（scripts/verify-dianxiaomi-verify.mjs）。
// 目前没有任何现有模块 import 它 —— 接入前不影响运行时。
//
// 一跨比 ecom 多两条约束（都是本项目的真实枚举形态决定的）：
//   1) sameSkuCode 禁用包含关系：WDZAI-1 与 WDZAI-11 用 includes 会互判通过；
//   2) sameSelection 对 ≤3 字中文禁用包含：肤色 / 肤色深 / 浅肤色 会互判通过。

export const COMMIT_VERIFIED = "VERIFIED";
export const COMMIT_MISMATCH = "MISMATCH";
export const COMMIT_UNREADABLE = "UNREADABLE";

/** 折叠空白并去首尾。所有比较前都先过这一层。 */
export function toText(value) {
    return String(value === null || value === undefined ? "" : value).replace(/\s+/g, " ").trim();
}

/**
 * 文本/数值字段的相等判定。
 * 空值判定**必须在相等判定之前**：否则 '' 与 '' 相等，会被判成"填进去了"——
 * 而那正是本层要消灭的静默失败（两侧都空说明这一步根本没写）。
 * 数字按**数值**比：页面常把 50 渲染成 50.00，逐字比必误报。
 */
export function sameText(actual, wanted) {
    const a = toText(actual);
    const b = toText(wanted);
    if (!a || !b) return false;
    if (a === b) return true;
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
    return false;
}

/**
 * 下拉字段的相等判定。回读常带前后缀（店铺后缀、状态标记）与换行，所以默认允许包含关系；
 * 但空值永不通过 —— 空就是"根本没选上"。
 *
 * strict=true 时要求归一后严格相等。**颜色/尺寸类字段必须传 strict**：默认的包含关系会让
 * 「肤色深」与「肤色」、「浅肤色」互判通过，那是最典型的"选错颜色也报 VERIFIED"。
 * 不用"短值禁用包含"这类长度启发式 —— 它会误伤「普货」这种最常见的两字值。
 */
export function sameSelection(actual, wanted, { strict = false } = {}) {
    const a = toText(actual);
    const b = toText(wanted);
    if (!a || !b) return false;
    if (a === b) return true;
    const ka = normalizeEnumKey(a);
    const kb = normalizeEnumKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    if (strict) return false;
    return ka.includes(kb) || kb.includes(ka);
}

/**
 * SKU 编码比较。**禁用包含关系**：WDZAI-1 与 WDZAI-11 用 includes 会互判通过，
 * 那正是"编码填错也报 VERIFIED"的典型形态。去空白 + 大写后严格相等。
 */
export function sameSkuCode(actual, wanted) {
    const strip = (value) => toText(value).replace(/\s+/g, "").toUpperCase();
    const a = strip(actual);
    const b = strip(wanted);
    if (!a || !b) return false;
    return a === b;
}

/**
 * 金额比较：剥掉币种符号后按**整数分**比。3.5 与 3.50 相等、¥16.74 与 16.74 相等，
 * 但 3.5 与 3.05 不等（浮点误差不会把错价放过）。
 */
export function sameMoney(actual, wanted) {
    const strip = (value) => toText(value).replace(/[^\d.\-]/g, "");
    const a = strip(actual);
    const b = strip(wanted);
    if (!a || !b) return false;
    const ca = Math.round(Number(a) * 100);
    const cb = Math.round(Number(b) * 100);
    if (!Number.isFinite(ca) || !Number.isFinite(cb)) return false;
    return ca === cb;
}

/** 枚举比较用的归一化键：小写 + 去掉非字母数字汉字。 */
export function normalizeEnumKey(value) {
    return String(value === null || value === undefined ? "" : value)
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

/**
 * 从多路候选里挑第一个非空值。**顺序即语义**：
 * rc-select 的 id 挂在 <input> 上，但那个 input 的 value 恒为空字符串，真实选中值只在
 * .ant-select-selection-item 里 —— 所以 selection-item 必须排在 innerText 之前
 * （innerText 会把整个框的文字都吞进来）。
 * 调用方按 [input.value, 后代 input.value, .ant-select-selection-item, 容器 selection-item, innerText] 传。
 */
export function pickEnumReadback(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    for (const value of list) {
        const text = toText(value);
        if (text) return text;
    }
    return "";
}

/** 回读结果 → 三态。verified 为真即 VERIFIED；否则有值=真不一致，无值=读不到。 */
export function commitState(verified, readback) {
    if (verified) return COMMIT_VERIFIED;
    return toText(readback) ? COMMIT_MISMATCH : COMMIT_UNREADABLE;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 写入 → 回读 → 三态。`read` 必须回读**目标控件自身**，不是"页面里任意一处看起来对的地方"。
 * write/read 是鸭子类型（可以是 playwright locator 的闭包，也可以是测试里的内存假件）。
 */
export async function commit({ write, read, wanted, compare = () => false, settleMs = 180, sleep = defaultSleep }) {
    await write();
    if (settleMs) await sleep(settleMs);
    let readback = "";
    try {
        readback = await read();
    }
    catch {
        readback = "";
    }
    const verified = Boolean(compare(readback, wanted));
    return {
        value: toText(wanted),
        readback: toText(readback),
        verified,
        state: commitState(verified, readback)
    };
}

/**
 * 断言：MISMATCH 抛错；UNREADABLE 按 escalateUnreadable 决定抛还是放过由调用方记录。
 * 报错必须带两侧原文 —— 只说"回读不一致"等于没说，现场照样查不出来。
 *
 * escalateUnreadable 取值建议（一跨）：
 *   钱/编码/重量/标题 → true（填错代价最高）
 *   店铺/备货类型/材质 → false（读法不稳，但填错代价可控 → 记 attention）
 */
export function assertVerified(result, { label = "字段", escalateUnreadable = true } = {}) {
    if (result && result.verified) return result;
    const got = toText(result && result.readback);
    const expected = toText(result && result.value);
    if (result && result.state === COMMIT_UNREADABLE && !escalateUnreadable) return result;
    throw new Error(
        `${label}回读不一致：期望「${expected || "(空)"}」，页面读到「${got || "(空)"}」；`
        + "请人工确认该字段，或核对控件定位是否仍匹配（页面可能已改版）。"
    );
}

/**
 * 未确认时留痕：不阻断，但必须写进 attention —— 沉默的"可能没生效"正是本层要消灭的东西。
 * 返回是否写入了留痕（便于调用方计数）。
 */
export function noteUnverified(sink, name, result) {
    if (!result || result.verified) return false;
    const line = `${name}回读未确认（${result.state}）：期望「${toText(result.value) || "(空)"}」，`
        + `页面读到「${toText(result.readback) || "(空)"}」；请上架后人工核对。`;
    if (Array.isArray(sink)) sink.push(line);
    return true;
}

/**
 * 多行断言（SKU 变体表）。逐行收集失败项，报错带**首个失败行号**与总数，
 * 而不是只说"有行不一致"——28 行的表里让你自己找是哪一行等于没报。
 *
 * entries: [{ index, field?, result }]，result 可省略一层（直接传 commit 结果）。
 * escalateUnreadable=false 时，若失败项全是 UNREADABLE 则只返回 soft 结果不抛。
 */
export function assertRowsVerified(entries, { label = "变种行", escalateUnreadable = true } = {}) {
    const list = Array.isArray(entries) ? entries : [];
    const failed = [];
    for (const entry of list) {
        const result = entry && entry.result ? entry.result : entry;
        if (result && result.verified) continue;
        failed.push({
            index: entry && Number.isInteger(entry.index) ? entry.index : failed.length,
            field: (entry && entry.field) || "",
            result
        });
    }
    if (!failed.length) return { total: list.length, failed: 0, soft: false, failedItems: [] };
    const soft = escalateUnreadable === false
        && failed.every((item) => item.result && item.result.state === COMMIT_UNREADABLE);
    if (soft) return { total: list.length, failed: failed.length, soft: true, failedItems: failed };
    const first = failed[0];
    const where = failed
        .slice(0, 5)
        .map((item) => `第 ${item.index + 1} 行${item.field ? "·" + item.field : ""}`)
        .join("、")
        + (failed.length > 5 ? ` 等 ${failed.length} 处` : "");
    throw new Error(
        `${label}回读不一致：${failed.length}/${list.length} 项未确认（${where}）；`
        + `第一处期望「${toText(first.result && first.result.value) || "(空)"}」，`
        + `页面读到「${toText(first.result && first.result.readback) || "(空)"}」。`
    );
}

/**
 * 输入框写入 + 回读（真实键盘）。
 * **不要**用 el.value = x + dispatchEvent：React 受控组件会用 state 覆盖回原值，
 * 而 dispatchEvent 不能保证受控组件接受，结果是"看起来填了、保存后是空的"。
 *
 * input 只需要有 click / press / pressSequentially / inputValue 四个方法（playwright locator 契约）。
 * 返回 { value, readback, verified, state }。
 */
export async function fillInputVerified(input, value, {
    label = "字段",
    settleMs = 180,
    escalateUnreadable = true,
    selectAll = "Control+A",
    sleep
} = {}) {
    const result = await commit({
        wanted: toText(value),
        settleMs,
        sleep,
        write: async () => {
            await input.click();
            await input.press(selectAll);
            await input.pressSequentially(String(value));
            await input.press("Tab");
        },
        read: () => input.inputValue(),
        compare: sameText
    });
    return assertVerified(result, { label, escalateUnreadable });
}

/**
 * 下拉选择 + 回读（走 pickEnumReadback 的多路取值）。
 * 沿用既有 choose() 做点击，本函数只负责"选完确认真的选上了"。
 */
export async function chooseVerified(page, selector, value, {
    label = "下拉",
    settleMs = 220,
    escalateUnreadable = false,
    strict = false,
    choose,
    sleep
} = {}) {
    const wanted = toText(value);
    if (!wanted) throw new Error(`${label}：值为空，无法选择（请补齐产品资料）。`);
    if (typeof choose !== "function") throw new Error(`${label}：缺少 choose 实现（本模块不直接依赖 playwright）。`);
    const result = await commit({
        wanted,
        settleMs,
        sleep,
        write: () => choose(page, selector, wanted),
        read: async () => {
            const parts = await page.evaluate((name) => {
                const node = document.querySelector(name);
                if (!node) return null;
                const box = node.closest(".ant-select") || node.parentElement || node;
                return [
                    node.tagName === "INPUT" ? node.value : "",
                    node.tagName === "INPUT" ? "" : String(node.querySelector && node.querySelector("input") ? node.querySelector("input").value : ""),
                    String(node.querySelector && node.querySelector(".ant-select-selection-item") ? node.querySelector(".ant-select-selection-item").textContent : ""),
                    String(box.querySelector && box.querySelector(".ant-select-selection-item") ? box.querySelector(".ant-select-selection-item").textContent : ""),
                    String(node.innerText || "")
                ];
            }, selector).catch(() => null);
            return parts ? pickEnumReadback(parts) : "";
        },
        compare: (actual, wanted) => sameSelection(actual, wanted, { strict })
    });
    return assertVerified(result, { label, escalateUnreadable });
}
