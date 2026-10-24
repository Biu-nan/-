// SKU / 商品信息 规范化 + 本地采购主数据读取
// 纪律：
//   - 历史 SKU 原样保留，仅"新建档"才应用字符替换规则
//   - 解析优先识别实际已建档的完整 SKU，再套用已确认映射；不得把所有 X / 直接认定为组合符号
//   - 不做模糊替代（不同颜色/规格不得互相替代）
'use strict';
const fs = require('fs');

// 新建档 SKU 字符规则（仅用于新 SKU 建档，不改历史）
function normalizeNewSku(sku) {
  return String(sku || '')
    .replace(/#/g, '_')
    .replace(/\*/g, 'X')
    .replace(/\+/g, '/')
    .replace(/ /g, '-');
}

// 出入记录/仓库清单「商品信息」列 → { sku, name, code }（best-effort，附 confidence）
// 已知形态：
//   "WDZAI183-Pink Red 粉红色 63001989"        -> sku=WDZAI183-Pink Red, name=粉红色, code=63001989
//   "1688 WDZD09-Style 5 5 63002022[未分类]"   -> source=1688, sku=..., code=63002022, cat=未分类
function parseCombinedProduct(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  const out = { raw: s, source: '', sku: '', name: '', code: '', category: '', confidence: 'low' };
  if (!s) return out;
  // 来源前缀
  const sm = s.match(/^(1688|速卖通|淘宝|拼多多|来源|smt|aliChoice)\s+/i);
  if (sm) { out.source = sm[1]; s = s.slice(sm[0].length); }
  // 分类后缀 [xxx]
  const cm = s.match(/\[([^\]]*)\]\s*$/);
  if (cm) { out.category = cm[1].trim(); s = s.slice(0, cm.index).trim(); }
  // 商品编码：末尾 6+ 位数字（优先）
  let code = '';
  const codeM = s.match(/\s(\d{6,})\s*$/);
  if (codeM) { code = codeM[1]; s = s.slice(0, codeM.index).trim(); }
  out.code = code;
  // SKU：以不含中文的连续首段为 SKU（含字母数字 - _ / # + . 空格变体）
  const tokens = s.split(' ');
  const skuToks = [];
  for (const t of tokens) {
    if (/[\u4e00-\u9fa5]/.test(t)) break; // 遇到中文即进入名称
    skuToks.push(t);
  }
  if (skuToks.length) {
    out.sku = skuToks.join(' ').trim();
    out.name = tokens.slice(skuToks.length).join(' ').trim();
    out.confidence = code ? 'high' : (out.sku ? 'medium' : 'low');
  } else {
    out.name = s;
  }
  return out;
}

// 读取本地采购主数据（若存在）
function loadMaster(dataRoot) {
  const p = require('path').join(dataRoot, 'master', 'sku-master.json');
  if (!fs.existsSync(p)) return { exists: false, path: p, entries: {}, rules: null };
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { exists: true, path: p, entries: j.entries || {}, rules: j.rules || null, version: j.version || null };
  } catch (e) {
    return { exists: false, path: p, error: e.message, entries: {} };
  }
}

// SKU 身份解析：优先精确 -> 已确认别名映射 -> 未知
function resolveSkuIdentity(rawSku, master) {
  const raw = String(rawSku || '').trim();
  const m = master && master.entries ? master.entries : {};
  if (m[raw]) {
    return { raw, base: m[raw].baseSku || raw, normalized: m[raw].normalizedSku || raw, layer: m[raw].fundLayer || null, match: 'exact' };
  }
  // 别名映射（shape: { alias: {baseSku,...} } 或 rules.aliases）
  const aliases = (master && master.rules && master.rules.aliases) || {};
  if (aliases[raw]) {
    return { raw, base: aliases[raw].baseSku || raw, normalized: aliases[raw].normalizedSku || raw, match: 'alias' };
  }
  return { raw, base: raw, normalized: raw, match: 'unknown' };
}

module.exports = { normalizeNewSku, parseCombinedProduct, loadMaster, resolveSkuIdentity };
