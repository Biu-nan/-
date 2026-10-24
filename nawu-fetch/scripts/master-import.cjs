#!/usr/bin/env node
// C6R 采购主数据导入：CSV/XLSX -> master/sku-master.json（按版本归档，不覆盖已确认版本）
//
// 用法：
//   node scripts/master-import.cjs --init                     # 生成填空模板 master/sku-master.template.{csv,xlsx}
//   node scripts/master-import.cjs --file <csv|xlsx> --version v1 --by Lance --note "首次录入"
//   node scripts/master-import.cjs --file ... --version v2 --allow-warnings
// 退出码：0 成功 | 2 校验有 ERROR | 3 有 WARNING 且未 --allow-warnings | 4 版本已存在且未 --force | 1 其它
'use strict';
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;

const fs = require('fs');
const path = require('path');
const out = require('../lib/output.cjs');
const master = require('../lib/master.cjs');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'procurement-config.json'), 'utf8'));

function parseArgs(a) {
  const o = { file: null, version: null, by: 'unknown', note: '', aliases: null, allowWarnings: false, force: false, init: false, dataRoot: CFG.dataRoot };
  for (let i = 2; i < a.length; i++) {
    const k = a[i];
    if (k === '--file') o.file = a[++i];
    else if (k === '--version') o.version = a[++i];
    else if (k === '--by') o.by = a[++i];
    else if (k === '--note') o.note = a[++i];
    else if (k === '--aliases') o.aliases = a[++i];
    else if (k === '--data-root') o.dataRoot = a[++i];
    else if (k === '--allow-warnings') o.allowWarnings = true;
    else if (k === '--force') o.force = true;
    else if (k === '--init') o.init = true;
  }
  return o;
}

const args = parseArgs(process.argv);
const dataRoot = args.dataRoot;

if (args.init) {
  const dir = out.ensureDir(path.join(dataRoot, 'master'));
  const example = {
    原始SKU: '示例-请删除 WDZAI37-Variant 8',
    基础物料SKU: 'WDZAI37-Variant 8',
    规范化SKU: 'WDZAI37-Variant-8',
    旧编码: '', 新编码: '', 资金层级: 'B', 生命周期分层: '主推', 采购模式: 'ORDER', LT1交期天: '7', 深度代发: '否',
    组合子SKU: '', 组合数量: '',
    首选供应商: '德振源头工厂', 采购参考价: '12.50', 来源平台: '1688', 来源URL: 'https://detail.1688.com/offer/xxxx.html', '1688配对状态': '已配对',
    特殊采购例外: '', 规则版本: 'v1', 生效时间: '2026-10-11', 变更来源: 'Lance',
  };
  const csv = path.join(dir, 'sku-master.template.csv');
  const xlsx = path.join(dir, 'sku-master.template.xlsx');
  out.writeCsv(csv, [example], master.TEMPLATE_COLUMNS);
  out.writeXlsx(xlsx, [example], '主数据模板');
  console.log('[init] 模板已生成：');
  console.log('  ' + csv);
  console.log('  ' + xlsx);
  console.log('列：' + master.TEMPLATE_COLUMNS.join(' | '));
  console.log('提示：组合件请在「组合子SKU」列用 `;` 分隔多个子SKU，形如 `WDZ01*2;WDZ02*1`（`*` 后为用量）。');
  process.exit(0);
}

if (!args.file || !args.version) {
  console.error('用法：node scripts/master-import.cjs --file <csv|xlsx> --version <vN> [--by X] [--note Y] [--allow-warnings] [--force]');
  process.exit(1);
}
if (!fs.existsSync(args.file)) { console.error('找不到文件：' + args.file); process.exit(1); }

const t = out.readTable(args.file);
const rows = (t.rows || []).filter((r) => String(r['原始SKU'] || '').trim());
console.log(`[read] ${path.basename(args.file)}：有效行 ${rows.length}（sheet=${t.sheetName}）`);

let aliases = {};
if (args.aliases) aliases = JSON.parse(fs.readFileSync(args.aliases, 'utf8'));

const { master: built, errors, warnings, counts } = master.buildMaster(rows, {
  version: args.version, by: args.by, note: args.note, aliases, source: 'Lance 已确认规则（人工录入）',
});

console.log('--- 校验 ---');
console.log(`条目 ${counts.entries}｜带层级 ${counts.withLayer}｜带BOM ${counts.withBom}｜带LT1 ${counts.withLt1}`);
console.log(`ERROR ${errors.length}｜WARNING ${warnings.length}`);
errors.slice(0, 30).forEach((e) => console.log('  ✗ ' + e));
warnings.slice(0, 30).forEach((w) => console.log('  ⚠ ' + w));
if (errors.length > 30) console.log(`  … 其余 ${errors.length - 30} 条错误省略`);
console.log('[纪律] 本工具不推断/不生成任何层级、交期、BOM —— 缺失即留空，须人工确认。');

if (errors.length) { console.error('✗ 存在 ERROR，拒绝导入（未写入任何文件）。'); process.exit(2); }
if (warnings.length && !args.allowWarnings) { console.error('⚠ 存在 WARNING，未指定 --allow-warnings，拒绝导入。'); process.exit(3); }

const vFile = master.versionFile(dataRoot, args.version);
if (fs.existsSync(vFile) && !args.force) { console.error(`✗ 版本已存在且不可变：${vFile}（如需覆盖请显式 --force，并另取新版本号更妥）`); process.exit(4); }

out.ensureDir(path.dirname(vFile));
out.writeJson(vFile, built);
out.writeJson(master.currentFile(dataRoot), built);
console.log('✓ 已写入：');
console.log('  ' + vFile + '  （不可变版本快照）');
console.log('  ' + master.currentFile(dataRoot) + '  （当前版本指针）');
console.log('  条目数=' + counts.entries + ' version=' + args.version);
process.exit(0);
