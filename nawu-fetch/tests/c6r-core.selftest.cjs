// C6R 时间窗口 / 门禁 / 规范化 离线自测（无浏览器、无副作用）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const tw = require('../lib/timewindow.cjs');
const storage = require('../lib/storage.cjs');
const gates = require('../lib/gates.cjs');
const norm = require('../lib/normalize.cjs');
const { buildManifest } = require('../lib/manifest.cjs');

let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label + (extra ? ' :: ' + extra : '')); } };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), label, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

console.log('== T1 时间窗口（决策日 2026-10-11）==');
const w = tw.purchaseWindows(new Date('2026-10-11T02:51:00Z')); // 北京时间 10:51
eq(w.decisionDate, '2026-10-11', 'decisionDate=2026-10-11');
eq(w.dataCutoff, '2026-10-11 12:00:00', 'dataCutoff=当天12:00');
eq(w.salesEnd, '2026-10-10 23:59:59', 'salesEnd=昨天23:59:59');
eq(w.last7.length, 7, 'last7 天数=7');
eq(w.last7[6], '2026-10-10', 'last7 末日=昨天');
eq(w.last7[0], '2026-10-04', 'last7 首日=2026-10-04');
eq(w.last30.length, 30, 'last30 天数=30');
eq(w.last30[0], '2026-09-11', 'last30 首日=2026-09-11');
eq(w.entryExit.from, '2026-09-06 00:00:00', 'entryExit.from=2026-09-06 00:00:00（与规格一致）');
eq(w.entryExit.to, '2026-10-10 23:59:59', 'entryExit.to=2026-10-10 23:59:59');
eq(w.entryExit.daysList.length, 35, 'entryExit 覆盖 35 天');

console.log('== T2 快照命名 ==');
const st = tw.stamp(new Date('2026-10-11T02:51:19Z'));
eq(st, '20261011-105119', 'stamp=YYYYMMDD-HHMMSS');
eq(storage.snapshotName('nawu-1店-inventory-latest', st, 'xlsx'), 'nawu-1店-inventory-latest_20261011-105119.xlsx', '快照名与规格一致');

console.log('== T3 门禁 ==');
const cellsStr = (s) => s.replace(/[\u4e00-\u9fa5]+/g, (m) => m.length > 6 ? m.slice(0, 6) : m).replace(/[#*+ ]/g, '_');
eq(norm.parseCombinedProduct('WDZAI183-Pink Red 粉红色 63001989').code, '63001989', '解析商品编码');
eq(norm.parseCombinedProduct('WDZAI183-Pink Red 粉红色 63001989').sku, 'WDZAI183-Pink Red', '解析SKU');
eq(norm.parseCombinedProduct('1688 WDZD09-Style 5 5 63002022[未分类]').category, '未分类', '解析分类');
eq(norm.parseCombinedProduct('1688 WDZD09-Style 5 5 63002022[未分类]').source, '1688', '解析来源');
eq(norm.normalizeNewSku('A#B*C+D E'), 'A_BXC/D-E', '新建档SKU字符规则');
eq(norm.resolveSkuIdentity('X1', { entries: { X1: { baseSku: 'B1' } } }).match, 'exact', 'SKU精确匹配优先');

const covOk = { coveredDays: w.last30.slice() };
const covBad = { coveredDays: w.last30.slice(0, 28) };
ok(gates.C3_salesCoverage(covOk, w).pass, 'C3 完整30日 -> PASS');
ok(!gates.C3_salesCoverage(covBad, w).pass && gates.C3_salesCoverage(covBad, w).flags.includes('SALES_WINDOW_INCOMPLETE'), 'C3 缺2日 -> FAIL+SALES_WINDOW_INCOMPLETE');
ok(gates.C6_noWrite([]).pass, 'C6 无写操作 -> PASS');
ok(!gates.C6_noWrite(['updateStock']).pass, 'C6 有写操作 -> FAIL');
const c1 = gates.C1_fileIntegrity([{ id: 'nawu1', ok: true, file: 'x', columns: ['a'], capturedAt: 'now' }], ['nawu1', 'nawu2']);
ok(!c1.pass && c1.missing.includes('nawu2'), 'C1 缺任务 -> FAIL 且列出缺失');

console.log('== T4 manifest ==');
const mf = buildManifest({
  taskDate: w.decisionDate, windows: w,
  taskResults: [{ id: 'nawu1', name: '纳物1店', ok: true, rawRows: 1200, uniqueSku: 1180, sha256: 'deadbeef', file: 'raw/2026-10-11/x.xlsx' }],
  gates: { pass: true, failed: [], gates: [] },
});
eq(mf.summary.total, 1, 'manifest.summary.total');
eq(mf.summary.ok, 1, 'manifest.summary.ok');
eq(mf.entryExitWindow.from, '2026-09-06 00:00:00', 'manifest 记录出入窗口');

console.log('== T5 storage 落盘 + sha256（临时目录）==');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'c6r-test-'));
const rd = storage.rawDay(tmpRoot, w.decisionDate);
const snap = storage.writeSnapshot(rd, 'test-row', st, [{ a: 1, b: 'x' }], 'sheet');
ok(fs.existsSync(snap.xlsxReal) && snap.sha256.length === 64, '快照落盘 + sha256(64hex)');
const mfFile = storage.writeManifest(tmpRoot, w.decisionDate, mf);
ok(fs.existsSync(mfFile), 'manifest 落盘');
ok(storage.listRawSnapshots(tmpRoot, w.decisionDate).length >= 1, '可列举当日 raw 快照');
fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n== 结果: PASS ${pass} / FAIL ${fail} ==`);
process.exit(fail ? 1 : 0);
