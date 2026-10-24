#!/usr/bin/env node
// C6R 采购主数据校验器（只读，不写任何文件）
// 用法：node scripts/master-validate.cjs [--file <sku-master.json>]
// 默认校验 master/sku-master.json（当前版本）；退出码 0=PASS(可能带WARN) 2=有ERROR 1=找不到文件
'use strict';
const fs = require('fs');
const path = require('path');
const master = require('../lib/master.cjs');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'procurement-config.json'), 'utf8'));
const dataRoot = CFG.dataRoot;

let file = master.currentFile(dataRoot);
const i = process.argv.indexOf('--file');
if (i >= 0) file = process.argv[i + 1];

if (!fs.existsSync(file)) { console.error('找不到主数据文件：' + file); process.exit(1); }
const m = master.loadMasterFile(file);
const entries = m.entries || {};

// 用 entries 反推行做一致性校验（含 BOM 环 / 别名 / 层级）
const v = master.validateEntries(entries, []);

// 别名映射校验（自指 / 成环）
const aliases = (m.rules && m.rules.aliases) || {};
for (const [a, t] of Object.entries(aliases)) {
  const tgt = (t && t.baseSku) || '';
  if (!tgt) v.warnings.push(`W-ALIAS ${a}：别名未指定 baseSku`);
  if (tgt === a) v.errors.push(`E-ALIAS ${a}：别名映射自指`);
}
// 别名环
for (const a of Object.keys(aliases)) {
  const seen = new Set([a]); let cur = a;
  for (let hop = 0; hop < 20; hop++) {
    cur = (aliases[cur] && aliases[cur].baseSku) || '';
    if (!cur) break;
    if (seen.has(cur)) { v.errors.push(`E-ALIAS-CYCLE 别名环：${a} -> ... -> ${cur}`); break; }
    seen.add(cur);
  }
}

const counts = {
  entries: Object.keys(entries).length,
  withLayer: Object.values(entries).filter((e) => e.fundLayer).length,
  withBom: Object.values(entries).filter((e) => e.bom && e.bom.length).length,
  withLt1: Object.values(entries).filter((e) => e.lt1Days !== null && e.lt1Days !== undefined).length,
  withSupplier: Object.values(entries).filter((e) => e.supplier).length,
};

console.log('文件：' + file);
console.log('version=' + (m.version || '?') + ' effectiveFrom=' + (m.effectiveFrom || '?') + ' source=' + (m.source || '?'));
console.log(`条目 ${counts.entries}｜层级 ${counts.withLayer}｜BOM ${counts.withBom}｜LT1 ${counts.withLt1}｜供应商 ${counts.withSupplier}`);
console.log(`ERROR ${v.errors.length}｜WARNING ${v.warnings.length}`);
v.errors.slice(0, 50).forEach((e) => console.log('  ✗ ' + e));
v.warnings.slice(0, 50).forEach((w) => console.log('  ⚠ ' + w));
console.log('推断后门：DISABLED —— 本校验器不会用历史销量补齐层级/交期/BOM。');
console.log(v.errors.length ? 'VERDICT: FAIL' : 'VERDICT: PASS' + (v.warnings.length ? ' (with warnings)' : ''));
process.exit(v.errors.length ? 2 : 0);
