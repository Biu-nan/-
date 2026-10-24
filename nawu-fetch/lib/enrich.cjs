// 缺口3：店小秘「仓库清单 × 商品管理」属性补齐
//
// 背景（2026-10-11 实测）：
//   - 仓库清单 DOM 只有 16 列，无「商品类型/商品状态」；
//   - 商品管理 DOM 的「状态」列实际文本为 `在售 「已配对」` / `在售`，已隐含 1688 配对状态；
//   - 两边「商品SKU」实测 1888/1888 完全命中。
//
// 纪律（对齐 C6R 规格 C2/C5）：
//   - 原始文件绝不修改；本模块只产出「另存结果」，未匹配项必须输出独立明细，不得静默删除；
//   - 以「商品SKU」精确匹配；同 SKU 多行时再用「商品编码」消歧，不做模糊替代、不跨仓库合并；
//   - 派生字段一律标注来源列，未知即留空，不猜测（尤其 商品类型，店小秘此页无该列）。
'use strict';

// 从商品管理「状态」文本派生 1688 配对状态
// 实测形态："在售 「已配对」"（1267 条）/ "在售"（621 条）
function derivePairStatus(statusText) {
  const s = String(statusText || '');
  const tag = (s.match(/[「\[]([^」\]]+)[」\]]/) || [])[1] || '';
  if (/已配对|已匹配|已关联/.test(s) || /已配对/.test(tag)) return '已配对';
  if (/未配对|未匹配|未关联/.test(s)) return '未配对';
  return '未知';
}

// 商品管理行 -> SKU 索引（一 SKU 可能多行，保留全部以做编码消歧）
function buildProductIndex(productRows) {
  const bySku = new Map();
  for (const r of productRows || []) {
    const sku = String(r['商品SKU'] || '').trim();
    if (!sku) continue;
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku).push(r);
  }
  return bySku;
}

// 主函数：仓库清单行 + 商品管理行 -> 补齐后的行 + 未匹配/冲突明细 + 统计
// opts.typeBySku / opts.flagBySku：来自商品管理「类型页签」采集（缺口3）
function enrichWarehouse(warehouseRows, productRows, opts) {
  const o = opts || {};
  const typeBySku = o.typeBySku || {};
  const flagBySku = o.flagBySku || {};
  // 仅当类型页签**确实采集成功**时，才可把"不在 组合/多变种/加工"判定为单品；否则留 UNKNOWN（不猜）
  const typeOf = (sku) => (!sku ? '' : (typeBySku[sku] || (o.typeAvailable ? '单品' : 'UNKNOWN')));
  const idx = buildProductIndex(productRows);
  const rows = [];
  const unmatched = [];
  const conflicts = [];
  const seen = new Set(); // 幂等：同一 (SKU,仓库位置,货架位) 只保留首次，重复计数（不删除，计入 conflicts）

  for (const w of warehouseRows || []) {
    const sku = String(w['商品SKU'] || '').trim();
    const code = String(w['商品编码'] || '').trim();
    const dedupKey = `${sku}||${w['仓库位置'] || ''}||${w['货架位'] || ''}`;
    if (seen.has(dedupKey)) conflicts.push({ 商品SKU: sku, 类型: 'DUP_ROW', 仓库位置: w['仓库位置'] || '', 货架位: w['货架位'] || '' });
    else seen.add(dedupKey);

    const hits = sku ? (idx.get(sku) || []) : [];
    if (!hits.length) {
      unmatched.push({ 商品SKU: sku, 商品编码: code, 仓库位置: w['仓库位置'] || '', 货架位: w['货架位'] || '', 商品名称: w['商品名称'] || '' });
      rows.push({ ...w, 商品状态: '', 配对状态: '', 商品类型: typeOf(sku), 有异常: flagBySku[sku] || '', 参考价CNY: '', 重量g: '', 归类来源: '未匹配' });
      continue;
    }
    let p = hits[0];
    if (hits.length > 1) {
      const same = hits.find((h) => String(h['商品编码'] || '').trim() === code);
      if (same) p = same;
      else conflicts.push({ 商品SKU: sku, 类型: 'MULTI_MATCH', 命中数: hits.length, 商品编码: code });
    }
    rows.push({
      ...w,
      商品状态: p['状态'] || '',
      配对状态: derivePairStatus(p['状态']),
      商品类型: typeOf(sku),
      有异常: flagBySku[sku] || '',
      参考价CNY: p['参考价CNY'] || '',
      重量g: p['重量g'] || '',
      归类来源: '商品管理',
    });
  }

  const stats = {
    total: (warehouseRows || []).length,
    matched: rows.filter((r) => r.归类来源 === '商品管理').length,
    unmatched: unmatched.length,
    conflicts: conflicts.length,
  };
  return { rows, unmatched, conflicts, stats };
}

// 仓库清单补齐结果的输出列顺序
function enrichedColumns(baseColumns) {
  const base = baseColumns && baseColumns.length
    ? baseColumns
    : ['来源', '商品SKU', '商品名称', '商品编码', '分类', '仓库位置', '货架位', '安全库存', '在途', '未发', '占用', '可用', '总量', '单价CNY', '总价CNY', '时间'];
  return [...base, '商品状态', '配对状态', '商品类型', '有异常', '参考价CNY', '重量g', '归类来源'];
}

module.exports = { derivePairStatus, buildProductIndex, enrichWarehouse, enrichedColumns };
