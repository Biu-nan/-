// C6R 采购主数据（SKU / 供应商 / 层级 / BOM / LT）核心库
//
// 设计原则（对齐规格 §二·任务07 与 §三·C5）：
//   1. 缺失即留空 + 记 UNKNOWN：本库**只做一致性校验**，绝不按历史销量推断层级、交期或 BOM。
//   2. 按版本保存：每次导入产出 master/versions/sku-master.<version>.json（不可变），
//      master/sku-master.json 仅为"当前版本"指针；已确认规则不被静默覆盖。
//   3. 历史 SKU 原样保留；字符规范化（# → _ 等）仅作用于"新建档"，且必须由人给定。
'use strict';
const fs = require('fs');
const path = require('path');
const normalize = require('./normalize.cjs');

// 填空模板列（CSV/XLSX 表头）
const TEMPLATE_COLUMNS = [
  '原始SKU', '基础物料SKU', '规范化SKU', '旧编码', '新编码',
  '资金层级', '生命周期分层', '采购模式', 'LT1交期天', '深度代发',
  '组合子SKU', '组合数量',
  '首选供应商', '采购参考价', '来源平台', '来源URL', '1688配对状态',
  '特殊采购例外', '规则版本', '生效时间', '变更来源',
];

// 受控词表
const FUND_LAYERS = ['A', 'B', 'C', 'D', 'E'];
const PROCURE_MODES = ['STOCK', 'ORDER', 'LIGHT_STOCK'];
const PAIR_STATUS = ['已配对', '未配对', '未知'];

function isBlank(v) { return v === null || v === undefined || String(v).trim() === ''; }

// "子SKU*2;子SKU2" 或 单子SKU + 组合数量
function parseBom(childStr, qtyStr) {
  const out = [];
  const segs = String(childStr || '').split(/[;|]/).map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return out;
  const fallbackQty = isBlank(qtyStr) ? null : Number(qtyStr);
  for (const s of segs) {
    const m = s.match(/^(.*?)\s*\*\s*(\d+)$/);
    if (m) out.push({ childSku: m[1].trim(), qty: Number(m[2]) });
    else out.push({ childSku: s, qty: Number.isFinite(fallbackQty) ? fallbackQty : null });
  }
  return out.filter((x) => x.childSku);
}

// 行 -> entries
function rowsToEntries(rows) {
  const entries = {};
  const dup = [];
  for (const r of rows || []) {
    const sku = String(r['原始SKU'] || '').trim();
    if (!sku) continue;
    if (entries[sku]) dup.push(sku);
    const lt1 = isBlank(r['LT1交期天']) ? null : Number(r['LT1交期天']);
    entries[sku] = {
      baseSku: String(r['基础物料SKU'] || '').trim() || sku,
      normalizedSku: String(r['规范化SKU'] || '').trim() || '',
      oldCode: String(r['旧编码'] || '').trim() || '',
      newCode: String(r['新编码'] || '').trim() || '',
      fundLayer: String(r['资金层级'] || '').trim() || null,
      lifecycle: String(r['生命周期分层'] || '').trim() || null,
      procureMode: String(r['采购模式'] || '').trim() || null,
      lt1Days: Number.isFinite(lt1) ? lt1 : null,
      deepDropship: isBlank(r['深度代发']) ? null : /^(1|true|是|y|yes)$/i.test(String(r['深度代发']).trim()),
      bom: parseBom(r['组合子SKU'], r['组合数量']),
      supplier: String(r['首选供应商'] || '').trim() || null,
      purchaseRefPrice: isBlank(r['采购参考价']) ? null : Number(r['采购参考价']),
      sourcePlatform: String(r['来源平台'] || '').trim() || null,
      sourceUrl: String(r['来源URL'] || '').trim() || null,
      pairStatus: String(r['1688配对状态'] || '').trim() || null,
      specialException: String(r['特殊采购例外'] || '').trim() || null,
      ruleVersion: String(r['规则版本'] || '').trim() || '',
      effectiveFrom: String(r['生效时间'] || '').trim() || '',
      changeSource: String(r['变更来源'] || '').trim() || '',
    };
  }
  return { entries, dup };
}

// 一致性校验（返回 errors/warnings，不做任何推断）
function validateEntries(entries, dupSkus) {
  const errors = [];
  const warnings = [];
  const skus = Object.keys(entries);

  if (dupSkus && dupSkus.length) {
    for (const s of [...new Set(dupSkus)]) errors.push(`E-DUP 原始SKU 重复：${s}（组合多子件请用「组合子SKU」列分号分隔，不要重复行）`);
  }

  for (const sku of skus) {
    const e = entries[sku];
    if (e.fundLayer && !FUND_LAYERS.includes(e.fundLayer)) errors.push(`E-LAYER ${sku}：资金层级「${e.fundLayer}」不在 A/B/C/D/E 内`);
    if (e.procureMode && !PROCURE_MODES.includes(e.procureMode)) errors.push(`E-MODE ${sku}：采购模式「${e.procureMode}」不在 STOCK/ORDER/LIGHT_STOCK 内`);
    if (e.lt1Days !== null && (!Number.isInteger(e.lt1Days) || e.lt1Days <= 0)) errors.push(`E-LT1 ${sku}：LT1 交期须为正整数（当前 ${e.lt1Days}）`);
    if (e.pairStatus && !PAIR_STATUS.includes(e.pairStatus)) warnings.push(`W-PAIR ${sku}：1688配对状态「${e.pairStatus}」不在 ${PAIR_STATUS.join('/')} 内`);
    if (e.normalizedSku && !e.baseSku) warnings.push(`W-NORM ${sku}：填了规范化SKU 但缺基础物料SKU（规范化应以基础物料SKU 为输入）`);
    if (e.normalizedSku && e.baseSku && e.baseSku === sku && e.normalizedSku !== normalize.normalizeNewSku(sku)) {
      warnings.push(`W-NORM ${sku}：规范化SKU 与内置字符规则结果不一致（规则： # → _ , * → X , + → / , 空格 → -）。历史SKU 可原样保留，请确认。`);
    }
    for (const b of e.bom) {
      if (b.qty !== null && (!Number.isInteger(b.qty) || b.qty <= 0)) errors.push(`E-BOM ${sku} -> ${b.childSku}：组合数量须为正整数`);
      if (!entries[b.childSku]) warnings.push(`W-BOM ${sku} -> ${b.childSku}：组合子SKU 未在本次主数据中建档（可能在其他批次，请确认）`);
    }
  }

  // BOM 环检测
  const color = new Map();
  const stack = [];
  function dfs(s) {
    color.set(s, 1); stack.push(s);
    for (const b of entries[s].bom) {
      if (!entries[b.childSku]) continue;
      if (color.get(b.childSku) === 1) {
        errors.push(`E-CYCLE BOM 循环引用：${[...stack.slice(stack.indexOf(b.childSku)), b.childSku].join(' -> ')}`);
      } else if (!color.get(b.childSku)) dfs(b.childSku);
    }
    stack.pop(); color.set(s, 2);
  }
  for (const sku of skus) if (!color.get(sku)) dfs(sku);

  return { errors, warnings, counts: { entries: skus.length, withLayer: skus.filter((s) => entries[s].fundLayer).length, withBom: skus.filter((s) => entries[s].bom.length).length, withLt1: skus.filter((s) => entries[s].lt1Days !== null).length } };
}

// 组装 master 对象
function buildMaster(rows, meta) {
  const { entries, dup } = rowsToEntries(rows);
  const v = validateEntries(entries, dup);
  const master = {
    version: meta.version,
    effectiveFrom: meta.effectiveFrom || new Date().toISOString().slice(0, 10),
    source: meta.source || 'Lance 已确认规则（人工录入）',
    generatedAt: new Date().toISOString(),
    note: '本文件为采购执行侧的本地权威主数据；资金层级/生命周期/采购模式/LT1/BOM 仅来自人工确认，严禁按历史销量推断。',
    rules: {
      charRules: { '#': '_', '*': 'X', '+': '/', ' ': '-' },
      aliases: meta.aliases || {},
      layers: FUND_LAYERS,
      modes: PROCURE_MODES,
    },
    changelog: meta.changelog || [{ version: meta.version, at: new Date().toISOString(), by: meta.by || 'unknown', note: meta.note || '' }],
    validation: { pass: v.errors.length === 0, errors: v.errors, warnings: v.warnings, counts: v.counts },
    entries,
  };
  return { master, errors: v.errors, warnings: v.warnings, counts: v.counts };
}

// 版本归档：不可变
function versionFile(dataRoot, version) {
  return path.join(dataRoot, 'master', 'versions', `sku-master.${version}.json`);
}
function currentFile(dataRoot) {
  return path.join(dataRoot, 'master', 'sku-master.json');
}

function loadMasterFile(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = {
  TEMPLATE_COLUMNS, FUND_LAYERS, PROCURE_MODES, PAIR_STATUS,
  parseBom, rowsToEntries, validateEntries, buildMaster,
  versionFile, currentFile, loadMasterFile,
};
