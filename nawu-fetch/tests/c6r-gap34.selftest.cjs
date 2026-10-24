// 缺口3/4 离线自测（纯函数，无浏览器）
'use strict';
const enrich = require('../lib/enrich.cjs');
const master = require('../lib/master.cjs');

let pass = 0, fail = 0;
function eq(name, a, b) { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n   got=${JSON.stringify(a)}\n   exp=${JSON.stringify(b)}`}`); }
function ok(name, c) { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${name}`); }

console.log('==== 缺口3：enrich ====');
eq('derivePairStatus 已配对', enrich.derivePairStatus('在售 「已配对」'), '已配对');
eq('derivePairStatus 在售', enrich.derivePairStatus('在售'), '未知');
eq('derivePairStatus 未配对', enrich.derivePairStatus('在售 「未配对」'), '未配对');
eq('derivePairStatus 空', enrich.derivePairStatus(''), '未知');

const wh = [
  { 商品SKU: 'A1', 商品编码: '100001', 商品名称: 'a', 仓库位置: '浙江义乌仓', 货架位: '无货架位' },
  { 商品SKU: 'B2', 商品编码: '100002', 商品名称: 'b', 仓库位置: '浙江义乌仓', 货架位: 'x' },
];
const pd = [
  { 商品SKU: 'A1', 商品编码: '100001', 状态: '在售 「已配对」', 参考价CNY: '9.9', 重量g: '5', 分类: '未分类' },
];
let r = enrich.enrichWarehouse(wh, pd, { typeBySku: { A1: '组合' }, typeAvailable: true });
eq('匹配数', r.stats.matched, 1);
eq('未匹配数', r.stats.unmatched, 1);
eq('A1 配对状态', r.rows[0].配对状态, '已配对');
eq('A1 商品类型(组合)', r.rows[0].商品类型, '组合');
eq('B2 商品类型(单品)', r.rows[1].商品类型, '单品');
eq('B2 归类来源', r.rows[1].归类来源, '未匹配');
eq('未匹配明细保留', r.unmatched[0].商品SKU, 'B2');

// 类型采集失败 -> UNKNOWN（不猜）
let r2 = enrich.enrichWarehouse(wh, pd, { typeAvailable: false });
eq('类型不可用 -> UNKNOWN', r2.rows[0].商品类型, 'UNKNOWN');

// 同 SKU 多行 -> 用商品编码消歧
const pd2 = [
  { 商品SKU: 'A1', 商品编码: '999999', 状态: '在售' },
  { 商品SKU: 'A1', 商品编码: '100001', 状态: '在售 「已配对」' },
];
let r3 = enrich.enrichWarehouse([wh[0]], pd2, { typeAvailable: true });
eq('多命中按编码消歧', r3.rows[0].配对状态, '已配对');
eq('多命中无冲突', r3.stats.conflicts, 0);

// 同 SKU+仓库+货架重复 -> 记冲突但不删
let r4 = enrich.enrichWarehouse([wh[0], { ...wh[0] }], pd, { typeAvailable: true });
eq('重复行计冲突', r4.stats.conflicts, 1);
eq('重复行仍保留', r4.rows.length, 2);

// 列顺序
ok('enrichedColumns 含 商品类型', enrich.enrichedColumns(null).includes('商品类型'));

console.log('\n==== 缺口4：master ====');
eq('parseBom 内联用量', master.parseBom('W1*2;W2*3', ''), [{ childSku: 'W1', qty: 2 }, { childSku: 'W2', qty: 3 }]);
eq('parseBom 单子件+数量列', master.parseBom('W1', '5'), [{ childSku: 'W1', qty: 5 }]);
eq('parseBom 单子件无数量', master.parseBom('W1', ''), [{ childSku: 'W1', qty: null }]);

const goodRows = [
  { 原始SKU: 'A1', 基础物料SKU: 'A1', 资金层级: 'B', 采购模式: 'ORDER', LT1交期天: '7', 组合子SKU: '', 组合数量: '' },
  { 原始SKU: 'C9', 基础物料SKU: 'C9', 资金层级: 'D', 采购模式: 'STOCK', LT1交期天: '15', 组合子SKU: 'A1*2', 组合数量: '' },
];
let gm = master.buildMaster(goodRows, { version: 'v-t1' });
eq('合法数据无错误', gm.errors.length, 0);
eq('BOM 解析', gm.master.entries.C9.bom[0].childSku, 'A1');
eq('层级统计', gm.counts.withLayer, 2);

const badRows = [
  { 原始SKU: 'B1', 资金层级: 'Z' },
  { 原始SKU: 'B2', 采购模式: 'WRONG' },
  { 原始SKU: 'B3', LT1交期天: '-3' },
  { 原始SKU: 'A1', 资金层级: 'A' },
  { 原始SKU: 'A1', 资金层级: 'A' },
];
let bm = master.buildMaster(badRows, { version: 'v-t2' });
ok('层级非法报错', bm.errors.some((e) => e.startsWith('E-LAYER')));
ok('模式非法报错', bm.errors.some((e) => e.startsWith('E-MODE')));
ok('LT1非法报错', bm.errors.some((e) => e.startsWith('E-LT1')));
ok('重复SKU报错', bm.errors.some((e) => e.startsWith('E-DUP')));

// BOM 环
const cyc = [
  { 原始SKU: 'X', 组合子SKU: 'Y*1' },
  { 原始SKU: 'Y', 组合子SKU: 'X*1' },
];
let cm = master.buildMaster(cyc, { version: 'v-t3' });
ok('BOM 环报错', cm.errors.some((e) => e.startsWith('E-CYCLE')));

// BOM 子件未建档 -> WARN
const orphan = [{ 原始SKU: 'X', 组合子SKU: 'NOT_EXIST*1' }];
let om = master.buildMaster(orphan, { version: 'v-t4' });
ok('BOM 子件未建档 WARN', om.warnings.some((w) => w.startsWith('W-BOM')));

// 规范化不一致 -> WARN
const norm = [{ 原始SKU: 'A#1', 基础物料SKU: 'A#1', 规范化SKU: 'A-1' }];
let nm = master.buildMaster(norm, { version: 'v-t5' });
ok('规范化字符规则不一致 WARN', nm.warnings.some((w) => w.startsWith('W-NORM')));

console.log(`\n==== 结果 ${pass}/${pass + fail} ====`);
process.exit(fail ? 1 : 0);
