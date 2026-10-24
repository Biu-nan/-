// C6R manifest 构建（每轮一份）
'use strict';

// taskResults 元素建议字段：
//  { id, name, pagePath, file, capturedAt, coverageFrom, coverageTo,
//    rawRows, uniqueSku, paginationComplete, expectedTotal, filtersComplete,
//    sha256, status, missingFields, error }
function buildManifest({ taskDate, windows, taskResults, gates, generatedAt }) {
  const tasks = taskResults.map((t) => ({
    id: t.id,
    name: t.name,
    pagePath: t.pagePath || null,
    file: t.file || null,
    capturedAt: t.capturedAt || null,
    coverageFrom: t.coverageFrom || null,
    coverageTo: t.coverageTo || null,
    rawRows: t.rawRows ?? 0,
    uniqueSku: t.uniqueSku ?? null,
    paginationComplete: t.paginationComplete ?? null,
    filtersComplete: t.filtersComplete ?? null,
    sha256: t.sha256 || null,
    status: t.ok ? (t.status || 'ok') : 'failed',
    missingFields: t.missingFields || [],
    error: t.error || null,
  }));
  return {
    taskDate,                      // 业务日期（采购决策日）
    generatedAt: generatedAt || new Date().toISOString(),
    timezone: windows.tz,
    dataCutoff: windows.dataCutoff,
    salesWindows: { ads7: windows.last7, p95_30: windows.last30 },
    entryExitWindow: { from: windows.entryExit.from, to: windows.entryExit.to, days: windows.entryExit.days },
    validation: gates ? { pass: gates.pass, blocking: gates.blocking || gates.failed, warnings: gates.warnings || [], failed: gates.failed, gates: gates.gates } : null,
    tasks,
    summary: {
      total: tasks.length,
      ok: tasks.filter((t) => t.status === 'ok').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      totalRows: tasks.reduce((a, t) => a + (t.rawRows || 0), 0),
    },
  };
}

module.exports = { buildManifest };
