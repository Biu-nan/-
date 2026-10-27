// SKU 表装载与计划（链接导出表 → 契约行 → 写入值）
//
// 来源：D:\ecom-translator\src\erp_sku_table.py（15 类别名、编码回退、唯一键、说明行过滤）
//      + src/erp_planner.py:1005-1175（库存门槛、变体上限、write_rows）
//      + collector/sku.py（**双币种不猜**：按店铺结算币种显式选列并留证）
//
// 设计取向（三件不可改的事）：
//   1) 双币种不猜 —— 同时有「价格」与「价格2」时必须有 explicit 选择，且理由进 report；
//   2) 原值可审计 —— rows（表里的原值）与 writeRows（实际写入值）分开存，永不互相覆盖；
//   3) 无币种即报错 —— 绝不默认 CNY。
//
// 本模块**不 import playwright**、不依赖运行时状态，可离线单测
// （scripts/verify-sku-table.mjs 用一张真实 AliPrice 导出表跑）。

// ── 列名别名（换商家表就换这张表）────────────────────────────────────────
const FIELD_ALIASES = {
    sku: ["sku", "skuid", "sku编号", "商家编码", "商家sku", "编码"],
    supply_price: ["供货价", "supplyprice", "申报价", "价格", "price"],
    inventory: ["库存", "inventory", "stock", "可售库存"],
    image: ["sku图片", "图片", "image", "skuimage"],
    style: ["sku名称", "名称", "款式", "style", "变体名", "颜色"],
    currency: ["currency", "币种"],
    product_id: ["产品id", "productid", "商品id"],
    barcode: ["货品条码", "条码", "barcode"],
    computed_price: ["计算价格", "computedprice"],
    shipping_cost: ["运费", "shippingcost"]
};

// AliPrice 的两个价格列：CNY 在前、USD 在后
const PRICE_CNY_HEADER = "价格";
const PRICE_USD_HEADER = "价格2";
const CANONICAL_SUPPLY_PRICE = "供货价";

// 说明行：命中即跳过（否则整包正常变体被连带拦下）
const NOTE_ROW_PATTERN = /勿拍|以上为|需勾选|合计|备注/;

export function normalizeKey(value) {
    return String(value === null || value === undefined ? "" : value)
        .replace(/[\s_\-（）()]/g, "")
        .toLowerCase();
}

/**
 * 最小 CSV 解析：支持双引号包裹（含逗号）、"" 转义、CRLF。
 * 电子表格导出的 SKU ID 常写成 "5881525976425"，裸 split 会把引号留在值里。
 */
export function parseCsv(text) {
    const source = String(text || "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        if (quoted) {
            if (ch === '"') {
                if (source[i + 1] === '"') { field += '"'; i += 1; }
                else quoted = false;
            }
            else field += ch;
            continue;
        }
        if (ch === '"') { quoted = true; continue; }
        if (ch === ",") { row.push(field); field = ""; continue; }
        if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
        if (ch === "\r") continue;
        field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((item) => item.some((cell) => String(cell).trim() !== ""));
}

function columnIndex(headers, canonical) {
    const aliases = FIELD_ALIASES[canonical] || [];
    const keys = headers.map(normalizeKey);
    for (const alias of aliases) {
        const index = keys.indexOf(normalizeKey(alias));
        if (index >= 0) return index;
    }
    return -1;
}

/** 金额解析：剥符号留数字 + 从 ¥/US$/€/£ 推断币种。 */
export function parseMoney(raw) {
    const text = String(raw === null || raw === undefined ? "" : raw).trim();
    if (!text) return { value: null, currency: "" };
    const numeric = text.replace(/[^\d.\-]/g, "");
    const value = Number(numeric);
    let currency = "";
    if (/US\$|\$/.test(text)) currency = "USD";
    else if (/¥|￥|CNY|RMB/i.test(text)) currency = "CNY";
    else if (/€|EUR/i.test(text)) currency = "EUR";
    else if (/£|GBP/i.test(text)) currency = "GBP";
    return { value: Number.isFinite(value) ? value : null, currency };
}

function toInteger(raw) {
    const text = String(raw === null || raw === undefined ? "" : raw).replace(/[^\d\-]/g, "");
    const value = Number(text);
    return Number.isFinite(value) ? value : 0;
}

/**
 * 选供货价列。**双币种不猜**：同时存在「价格」与「价格2」时，必须由调用方指定
 * supplyPriceColumn（或店铺 profile 指定），否则返回问题项等人工裁决。
 * 不做"取第一个看起来像价格的列"这种事——币种错了，报价就错了。
 */
export function pickSupplyPriceColumn(headers, { supplyPriceColumn = "" } = {}) {
    const keys = headers.map(normalizeKey);
    if (supplyPriceColumn) {
        const index = keys.indexOf(normalizeKey(supplyPriceColumn));
        if (index < 0) {
            return { index: -1, reason: `指定的供货价列「${supplyPriceColumn}」不在表头里`, problem: "SUPPLY_COLUMN_NOT_FOUND" };
        }
        return { index, reason: `按显式指定取「${headers[index]}」` };
    }
    const explicit = keys.findIndex((key) => ["供货价", "supplyprice", "申报价"].includes(key));
    if (explicit >= 0) return { index: explicit, reason: `已存在显式供货价列「${headers[explicit]}」` };

    const cny = keys.indexOf(normalizeKey(PRICE_CNY_HEADER));
    const usd = keys.indexOf(normalizeKey(PRICE_USD_HEADER));
    if (cny >= 0 && usd >= 0) {
        return {
            index: -1,
            problem: "DUAL_CURRENCY",
            reason: `SKU 表同时存在「${PRICE_CNY_HEADER}」与「${PRICE_USD_HEADER}」；请用 supplyPriceColumn 明确供货价列（国内履约店铺取 CNY 列），不替你做选择。`
        };
    }
    if (cny >= 0) return { index: cny, reason: `取「${headers[cny]}」列` };
    if (usd >= 0) return { index: usd, reason: `仅有「${headers[usd]}」列，取用之（注意币种为 USD）` };
    return { index: -1, problem: "SUPPLY_COLUMN_MISSING", reason: `找不到供货价列；表头：${headers.join("、")}` };
}

/**
 * 装载 SKU 表。
 * @param {object} options
 * @param {string} options.text     CSV 文本（已解码）
 * @param {string} [options.supplyPriceColumn]  双币种时必填
 * @param {string} [options.defaultProductId]   表内无产品ID列时补上（约定：一个包一张表）
 * @param {string} [options.storeId]            参与唯一键
 */
export function loadSkuTable({ text, supplyPriceColumn = "", defaultProductId = "", storeId = "" } = {}) {
    const parsed = parseCsv(text);
    const problems = [];
    const warnings = [];
    if (!parsed.length) {
        return { headers: [], rows: [], currency: "", problems: [{ code: "EMPTY_TABLE", message: "SKU 表为空" }], warnings };
    }
    const headers = parsed[0].map((cell) => String(cell).trim());
    const priceColumn = pickSupplyPriceColumn(headers, { supplyPriceColumn });
    if (priceColumn.problem) {
        problems.push({ code: priceColumn.problem, message: priceColumn.reason });
        return { headers, rows: [], currency: "", supplyPriceColumn: "", supplyPriceReason: priceColumn.reason, problems, warnings };
    }
    const idx = {
        sku: columnIndex(headers, "sku"),
        style: columnIndex(headers, "style"),
        inventory: columnIndex(headers, "inventory"),
        image: columnIndex(headers, "image"),
        currency: columnIndex(headers, "currency"),
        barcode: columnIndex(headers, "barcode"),
        productId: columnIndex(headers, "product_id"),
        price: priceColumn.index
    };
    if (idx.sku < 0) problems.push({ code: "SKU_COLUMN_MISSING", message: `缺少 SKU 编码列（可用名：${FIELD_ALIASES.sku.join("/")}）` });

    const rows = [];
    parsed.slice(1).forEach((cells, offset) => {
        const text0 = cells.map((cell) => String(cell || "").trim());
        if (NOTE_ROW_PATTERN.test(text0.join(" "))) {
            warnings.push(`第 ${offset + 2} 行是说明行，已跳过：${text0.slice(0, 3).join(" | ")}`);
            return;
        }
        const money = parseMoney(cells[idx.price]);
        if (!money.value) {
            warnings.push(`第 ${offset + 2} 行没有可用供货价，已跳过`);
            return;
        }
        const rawCurrency = idx.currency >= 0 ? String(cells[idx.currency] || "").trim().toUpperCase() : "";
        const currency = rawCurrency || money.currency;
        if (!currency) {
            problems.push({ code: "CURRENCY_UNKNOWN", message: `第 ${offset + 2} 行既无币种列也无币种符号，拒绝默认 CNY` });
        }
        rows.push({
            rowNumber: offset + 2,
            productId: (idx.productId >= 0 ? String(cells[idx.productId] || "").trim() : "") || defaultProductId,
            store: storeId,
            sku: (idx.sku >= 0 ? String(cells[idx.sku] || "").trim() : ""),
            style: idx.style >= 0 ? String(cells[idx.style] || "").trim() : "",
            supplyPrice: money.value,
            currency,
            inventory: idx.inventory >= 0 ? toInteger(cells[idx.inventory]) : 0,
            image: idx.image >= 0 ? String(cells[idx.image] || "").trim() : "",
            barcode: idx.barcode >= 0 ? String(cells[idx.barcode] || "").trim() : ""
        });
    });

    // 唯一键 (productId, store, sku)：重复即报错，不做去重——静默去重会让"少一个变体"永远查不出来
    const seen = new Map();
    const duplicates = [];
    for (const row of rows) {
        const key = `${row.productId}|${row.store}|${row.sku}`;
        if (!row.sku) continue;
        if (seen.has(key)) duplicates.push(`${row.sku}（第 ${seen.get(key)} 行与第 ${row.rowNumber} 行）`);
        else seen.set(key, row.rowNumber);
    }
    if (duplicates.length) {
        problems.push({ code: "DUPLICATE_KEY", message: `SKU 编码重复：${duplicates.slice(0, 5).join("、")}` });
    }
    const currencies = [...new Set(rows.map((row) => row.currency).filter(Boolean))];
    if (currencies.length > 1) {
        problems.push({ code: "MIXED_CURRENCY", message: `同一张表里出现多种币种：${currencies.join("、")}；请确认是否选错了供货价列` });
    }
    return {
        headers,
        rows,
        currency: currencies[0] || "",
        supplyPriceColumn: headers[idx.price] || "",
        supplyPriceReason: priceColumn.reason,
        currencies,
        problems,
        warnings
    };
}

/**
 * 库存门槛 + 变体上限（先门槛、后上限，按库存降序择优，但**输出保持原表顺序**）。
 * 顺序重要：SKU 行序与销售属性勾选顺序必须一致，否则价格会填到别人的行上。
 */
export function planSkuRows(rows, { minStock = 0, maxVariants = 0 } = {}) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    if (!list.length || (minStock <= 0 && maxVariants <= 0)) {
        return { kept: list, dropped: [], stockFilter: { minStock, maxVariants, enabled: false } };
    }
    const above = list.filter((row) => Number(row.inventory || 0) >= minStock);
    const dropped = list.filter((row) => Number(row.inventory || 0) < minStock);
    let kept = above;
    if (maxVariants > 0 && above.length > maxVariants) {
        const byStock = above
            .map((row, index) => ({ index, row, stock: Number(row.inventory || 0) }))
            .sort((a, b) => (b.stock - a.stock) || (a.index - b.index))
            .slice(0, maxVariants)
            .map((item) => item.index);
        const keep = new Set(byStock);
        kept = above.filter((_, index) => keep.has(index));
    }
    return {
        kept,
        dropped: dropped.map((row) => ({ sku: row.sku, style: row.style, inventory: row.inventory })),
        stockFilter: { minStock, maxVariants, enabled: true, before: list.length, after: kept.length }
    };
}

const ENGLISH_SAFE = /^[A-Za-z0-9 .,()&+\-_/]{1,20}$/;

/**
 * 生成写入值（writeRows）。与 rows 分开存：rows 是表里的原值，writeRows 是真正要填进页面的值。
 *
 * @param {object} options
 * @param {number} [options.customNameLimit] 自定义名长度上限（店小秘实测 20）
 * @param {number} [options.inventory]       统一写入库存（杭州JIT库存）
 * @param {string} [options.warehouse]       仓库名（仅审计用）
 * @param {(row, index, all) => string} [options.customNameBuilder] 变体名生成器（中文→英文，需按品类注入）
 */
export function buildWriteRows(rows, {
    customNameLimit = 20,
    inventory = 50,
    warehouse = "杭州JIT库存",
    skuPrefix = "",
    customNameBuilder
} = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const used = new Map();
    return list.map((row, index) => {
        const sourceName = String(row.style || "").trim();
        let customName = "";
        let nameSource = "fallback";
        if (ENGLISH_SAFE.test(sourceName) && sourceName.length <= customNameLimit) {
            customName = sourceName;
            nameSource = "source";
        }
        else if (typeof customNameBuilder === "function") {
            const built = String(customNameBuilder(row, index, list) || "").trim();
            if (built) {
                customName = built.slice(0, customNameLimit);
                nameSource = "builder";
            }
        }
        if (!customName) {
            customName = `Variant ${index + 1}`.slice(0, customNameLimit);
            nameSource = "fallback";
        }
        // 同包重名加序号（不能静默——names 冲突时页面会把两个变体当同一个）
        const key = customName.toLowerCase();
        if (used.has(key)) {
            const next = used.get(key) + 1;
            used.set(key, next);
            const suffix = `-${next}`;
            customName = `${customName.slice(0, customNameLimit - suffix.length)}${suffix}`;
        }
        else {
            used.set(key, 1);
        }
        const skuCode = String(row.sku || "").trim();
        return {
            sourceRowNumber: row.rowNumber,
            sourceSkuId: row.sku,
            sourceCustomName: sourceName,
            customName,
            customNameSource: nameSource,
            customNameRequiresHumanReview: nameSource === "fallback",
            skuCode: skuCode ? `${skuPrefix}${skuCode}`.slice(0, 64) : "",
            skuCodeSource: skuCode ? "table_sku_id" : "missing",
            supplyPrice: row.supplyPrice,
            currency: row.currency,
            sourceInventory: row.inventory,
            warehouse,
            inventory,
            skuImageUrl: row.image
        };
    });
}
