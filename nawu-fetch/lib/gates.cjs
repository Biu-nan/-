// C6R 质量门禁 C1–C6
// 每轮采集后运行；门禁只做"判定 + 报告"，不擅自补数据、不豁免。
'use strict';

// C1 文件完整性
function C1_fileIntegrity(taskResults, requiredIds) {
  const byId = Object.fromEntries(taskResults.map((t) => [t.id, t]));
  const missing = [];
  const bad = [];
  for (const id of requiredIds) {
    const t = byId[id];
    if (!t) { missing.push(id); continue; }
    if (!t.ok) { bad.push(`${id}: ${t.error || '采集失败'}`); continue; }
    if (!t.file) { bad.push(`${id}: 无产物文件`); continue; }
    if (!t.columns || !t.columns.length) bad.push(`${id}: 无有效表头`);
    if (!t.capturedAt) bad.push(`${id}: 缺抓取时间`);
  }
  return {
    code: 'C1', name: '文件完整性', pass: !missing.length && !bad.length,
    missing, bad,
    detail: `必采任务 ${requiredIds.length} 个；缺失 ${missing.length}；异常 ${bad.length}`,
  };
}

// C2 数据行完整性
function C2_rowIntegrity(taskResults) {
  const issues = [];
  for (const t of taskResults) {
    if (!t.ok) continue;
    if (t.paginationComplete === false) issues.push(`${t.id}: 分页未完成（期望 ${t.expectedTotal ?? '?'}，实得 ${t.rawRows}）`);
    if (t.expectedTotal != null && t.rawRows > 0 && t.rawRows < Math.floor(t.expectedTotal * 0.98) && (t.name || '').includes('清单')) {
      issues.push(`${t.id}: 记录数(${t.rawRows}) 显著少于页面总数(${t.expectedTotal})`);
    }
    if (t.zeroOrNegativeKept === false) issues.push(`${t.id}: 存在零/负库存被过滤风险`);
  }
  return { code: 'C2', name: '数据行完整性', pass: !issues.length, issues, detail: issues.join(' | ') || '分页/记录数/零负库存保留均正常' };
}

// C3 销量覆盖
function C3_salesCoverage(coverageMap, windows) {
  const required = windows.last30;
  const covered = coverageMap && coverageMap.coveredDays ? new Set(coverageMap.coveredDays) : new Set();
  const miss = required.filter((d) => !covered.has(d));
  const pass = miss.length === 0;
  const flags = [];
  if (!pass) flags.push('SALES_WINDOW_INCOMPLETE');
  return {
    code: 'C3', name: '销量覆盖', pass, flags,
    coveredCount: covered.size, requiredCount: required.length, missingDays: miss,
    detail: pass ? `最近 ${required.length} 个自然日覆盖完整` : `30 日窗口缺 ${miss.length} 天未覆盖`,
  };
}

// C4 采购订单核验
// knownGap：SKU 级未到货明细需从采购详情补充（当前仅有整单级），记录为已知缺口而非静默通过。
function C4_purchaseOrders(poTask) {
  if (!poTask || !poTask.ok) return { code: 'C4', name: '采购订单核验', pass: false, detail: '采购订单未采集' };
  const issues = [];
  if (poTask.paginationComplete === false) issues.push('采购订单分页未完成');
  if (poTask.unmatchedSkuExcluded) issues.push('导出排除了未配对 SKU（不得视为全部采购订单）');
  if (!poTask.hasSkuLevel) issues.push('缺少 SKU 级未到货明细（当前仅整单级，需从采购详情/采购跟单补充）');
  const knownGap = !poTask.hasSkuLevel;
  return {
    code: 'C4', name: '采购订单核验', pass: !issues.length, knownGap, issues,
    detail: issues.length ? issues.join(' | ') : `未结采购单 ${poTask.openCount ?? '?'} 条，SKU 级明细可追溯`,
  };
}

// C5 SKU 映射
// 通过条件：无异常，或"异常已输出独立明细"（规格：映射异常不可静默删除）
function C5_skuMapping(mapReport) {
  if (!mapReport) return { code: 'C5', name: 'SKU映射', pass: true, skipped: true, detail: '本轮未做 SKU 映射' };
  const { exact = 0, alias = 0, anomalies = 0, anomaliesDetailed = false, detailFile = '' } = mapReport;
  const pass = anomalies === 0 || anomaliesDetailed;
  return {
    code: 'C5', name: 'SKU映射', pass, exact, alias, anomalies, detailFile, anomaliesDetailed,
    detail: anomalies === 0
      ? `精确 ${exact}，别名 ${alias}，无异常`
      : `精确 ${exact}，别名 ${alias}，异常 ${anomalies}${anomaliesDetailed ? `（已输出独立明细 ${detailFile || 'inline'}）` : '（未输出明细 = 违规）'}`,
  };
}

// C6 不执行业务写操作（静态断言：仅记录本轮实际调用的写操作，应为 0）
function C6_noWrite(writeOps) {
  const ops = writeOps || [];
  return { code: 'C6', name: '不执行业务写操作', pass: ops.length === 0, writeOps: ops, detail: ops.length ? `检测到写操作：${ops.join(',')}` : '本轮仅只读页面与导出，无业务写操作' };
}

function runAllGates(ctx) {
  const req = ctx.requiredIds || [];
  const has = (id) => req.includes(id);
  const po = ctx.taskResults.find((t) => t.id === '06');
  const gates = [
    C1_fileIntegrity(ctx.taskResults, req),
    C2_rowIntegrity(ctx.taskResults),
    has('05') ? C3_salesCoverage(ctx.coverageMap, ctx.windows) : { code: 'C3', name: '销量覆盖', pass: true, skipped: true, detail: '本轮未运行出入记录任务' },
    has('06') ? C4_purchaseOrders(po) : { code: 'C4', name: '采购订单核验', pass: true, skipped: true, detail: '本轮未运行采购订单任务' },
    (ctx.skuMapReport || has('07')) ? C5_skuMapping(ctx.skuMapReport) : { code: 'C5', name: 'SKU映射', pass: true, skipped: true, detail: '本轮未运行主数据任务' },
    C6_noWrite(ctx.writeOps),
  ];
  const blocking = gates.filter((g) => !g.pass && !g.knownGap);
  const warnings = gates.filter((g) => !g.pass && g.knownGap).map((g) => g.code);
  const pass = blocking.length === 0;
  return { pass, gates, failed: gates.filter((g) => !g.pass).map((g) => g.code), blocking: blocking.map((g) => g.code), warnings };
}

module.exports = { C1_fileIntegrity, C2_rowIntegrity, C3_salesCoverage, C4_purchaseOrders, C5_skuMapping, C6_noWrite, runAllGates };
