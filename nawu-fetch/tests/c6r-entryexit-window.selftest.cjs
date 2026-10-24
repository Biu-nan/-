// 出入记录窗口采集（collectEntryExitWindow）离线自测：无浏览器、无网络。
// 覆盖：降序早停 / 升序兜底不全停 / 窗口截断 / 覆盖自然日计数。
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';
'use strict';

const { collectEntryExitWindow, ENTRYEXIT_COLUMNS } = require('../lib/dxm-c6r.cjs');

let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label + (extra ? ' :: ' + extra : '')); } };

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, step: () => {} };
const day = (n) => { const d = new Date(Date.UTC(2026, 7, 1) + n * 86400000); return d.toISOString().slice(0, 10); };
const ALL_DAYS = Array.from({ length: 120 }, (_, i) => day(i)); // 2026-08-01 起 120 天

// 造一个分页数据集：pages = [[日期...], ...]，每个日期一行
function makeHarness(pages) {
  let cursor = 0;
  const pageMock = { evaluate: async () => 'CLICKED' }; // setEntryExitAllTime 视为成功
  const extractor = async () => (cursor < pages.length ? pages[cursor].map((d) => ({ 时间: d + ' 09:00:00', 商品信息: 'SKU-' + d })) : []);
  const goNextPage = async () => { cursor += 1; return cursor < pages.length ? 'CLICKED' : 'DISABLED'; };
  return { pageMock, extractor, goNextPage };
}

const FROM = '2026-09-07', TO = '2026-10-11'; // 35 天窗口
const expectCovered = (() => { const out = []; for (const d of ALL_DAYS) if (d >= FROM && d <= TO) out.push(d); return out; })();

(async () => {
  console.log('== W1 降序表：进入窗口后再遇更早记录 → 早停 ==');
  {
    // 倒序 12 页，每页 20 天：从 10-11 往回翻
    const desc = ALL_DAYS.slice().reverse();
    const pages = [];
    for (let i = 0; i < desc.length; i += 20) pages.push(desc.slice(i, i + 20));
    const h = makeHarness(pages);
    const res = await collectEntryExitWindow(h.pageMock, { fromDate: FROM, toDate: TO, extractor: h.extractor, goNextPage: h.goNextPage, sleep: async () => {}, maxPages: 120 }, noopLog);
    ok(res.filterMode === 'ALL', '时间筛选走「全部」');
    ok(res.reachedBoundary === true, '降序：触发早停');
    ok(res.scanned < ALL_DAYS.length, `扫描行数(${res.scanned}) < 全量(${ALL_DAYS.length})：确实早停而非全量`);
    ok(res.rows.length === expectCovered.length, `窗口内行数=${res.rows.length}（期望 ${expectCovered.length}）`);
    ok(res.rows.every((r) => r.时间.slice(0, 10) >= FROM && r.时间.slice(0, 10) <= TO), '窗口外行已被截断');
    ok(res.coveredDays.length === 35 && res.coveredDays[0] === FROM && res.coveredDays[34] === TO, `覆盖 35 个自然日（${res.coveredDays[0]}~${res.coveredDays[34]}）`);
  }

  console.log('== W2 升序表：不得在边界页误停（回归：曾只取到 3 天）==');
  {
    const pages = [];
    for (let i = 0; i < ALL_DAYS.length; i += 20) pages.push(ALL_DAYS.slice(i, i + 20));
    const h = makeHarness(pages);
    const res = await collectEntryExitWindow(h.pageMock, { fromDate: FROM, toDate: TO, extractor: h.extractor, goNextPage: h.goNextPage, sleep: async () => {}, maxPages: 120 }, noopLog);
    ok(res.rows.length === expectCovered.length, `窗口内行数=${res.rows.length}（期望 ${expectCovered.length}）`);
    ok(res.coveredDays.length === 35, `升序：覆盖 ${res.coveredDays.length} 个自然日（期望 35）`);
    ok(res.scanned === 100, `升序：翻过边界页、越过窗口终点后才停（扫描 ${res.scanned} 行；旧缺陷会在 40 行/3 天处误停）`);
    ok(res.complete === true, '全量翻完 complete=true');
  }

  console.log('== W3 全部按钮不可用 → 回退自定义范围 ==');
  {
    const pages = [];
    for (let i = 0; i < ALL_DAYS.length; i += 20) pages.push(ALL_DAYS.slice(i, i + 20));
    let evaluated = 0;
    const pageMock = {
      evaluate: async () => { evaluated++; return evaluated === 1 ? 'NOT_FOUND' : 'NOT_FOUND'; },
      keyboard: { press: async () => {} },
    };
    let cursor = 0;
    const res = await collectEntryExitWindow(pageMock, {
      fromDate: FROM, toDate: TO,
      extractor: async () => (cursor < pages.length ? pages[cursor].map((d) => ({ 时间: d + ' 09:00:00' })) : []),
      goNextPage: async () => { cursor += 1; return cursor < pages.length ? 'CLICKED' : 'DISABLED'; },
      sleep: async () => {}, maxPages: 120,
    }, noopLog);
    ok(res.filterMode === 'RANGE', '「全部」失败 → filterMode=RANGE（走了回退分支）');
    ok(res.rows.length === expectCovered.length, `回退路径窗口内行数=${res.rows.length}（期望 ${expectCovered.length}）`);
  }

  console.log('== W4 缺 extractor 参数 → 快速失败 ==');
  {
    let threw = false;
    try { await collectEntryExitWindow({ evaluate: async () => 'CLICKED' }, { fromDate: FROM, toDate: TO }, noopLog); } catch (e) { threw = true; }
    ok(threw, '缺 extractor/goNextPage 时抛错（不静默返回空）');
  }

  console.log('== W5 列定义含来源单号 ==');
  ok(ENTRYEXIT_COLUMNS.includes('来源单号') && ENTRYEXIT_COLUMNS.includes('流水号'), 'ENTRYEXIT_COLUMNS 含 流水号 + 来源单号');

  console.log(`\n== 结果: PASS ${pass} / FAIL ${fail} ==`);
  process.exit(fail ? 1 : 0);
})();
