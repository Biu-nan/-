#!/usr/bin/env node
// 纳物每日采购数据抓取 · C6R 统一编排
//
// 7 项任务：
//   01 纳物1店官方仓   02 纳物2店官方仓
//   03 店小秘仓库清单  04 店小秘商品管理
//   05 店小秘出入记录(35天)  06 采购订单(未结+近35天已完成/取消)  07 SKU/供货商主数据
//
// 只读铁律：仅导航 + 导出 + 读取。不创建采购单、不改库存、不取消订单、不签收、不付款。
//
// 用法：
//   node procurement-fetch.cjs                # 全部任务
//   node procurement-fetch.cjs --tasks 05,06,07
//   node procurement-fetch.cjs --no-nawu      # 跳过纳物侧（无稳卖时）
//   node procurement-fetch.cjs --no-dxm       # 跳过店小秘侧（无 CDP 时）
//   node procurement-fetch.cjs --dry          # 只算窗口/读配置，不采集
//
// 注意：本机 shell 设了 http_proxy，会劫持 localhost 请求，必须在加载任何网络库之前清掉
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const out = require('./lib/output.cjs');
const storage = require('./lib/storage.cjs');
const tw = require('./lib/timewindow.cjs');
const gates = require('./lib/gates.cjs');
const { buildManifest } = require('./lib/manifest.cjs');
const dxm = require('./lib/dxm-warehouse.cjs');
const c6r = require('./lib/dxm-c6r.cjs');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'procurement-config.json'), 'utf8'));
const DXM_CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'dxm-config.json'), 'utf8'));

function parseArgs(argv) {
  const a = { tasks: null, noNawu: false, noDxm: false, dry: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--tasks') a.tasks = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === '--no-nawu') a.noNawu = true;
    else if (argv[i] === '--no-dxm') a.noDxm = true;
    else if (argv[i] === '--dry') a.dry = true;
  }
  return a;
}

const argv = parseArgs(process.argv);
const want = (id) => (!argv.tasks || argv.tasks.includes(id));
const uniqueSku = (rows, key) => new Set(rows.map((r) => String(r[key] || '').trim()).filter(Boolean)).size;

function runChild(args, log) {
  try {
    execFileSync(process.execPath, args, { cwd: __dirname, stdio: 'inherit', env: { ...process.env, NO_PROXY: '*', http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '' } });
    return true;
  } catch (e) { log.error('子任务失败 ' + args.join(' ') + ' :: ' + (e.message || '').split('\n')[0]); return false; }
}

// 把 legacy -latest.xlsx 快照进 raw/YYYY-MM-DD/<prefix>_<stamp>.xlsx（历史不覆盖）
// 注意：xlsx 被 Excel 占用时 writeXlsx 会另存为 <prefix>.locked.xlsx，故两个候选按 mtime 取最新，避免快照到旧文件。
function snapshotLegacy(dir, legacyPrefix, rawDayDir, snapPrefix, stamp, sheet, log) {
  const cands = [path.join(dir, legacyPrefix + '.xlsx'), path.join(dir, legacyPrefix + '.locked.xlsx')]
    .filter((f) => fs.existsSync(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const file = cands[0];
  if (!file) return { ok: false, error: '缺少 ' + legacyPrefix + '.xlsx' };
  const t = out.readTable(file);
  const rows = t.rows || [];
  const dest = path.join(rawDayDir, storage.snapshotName(snapPrefix, stamp, 'xlsx'));
  fs.copyFileSync(file, dest);
  const res = { ok: true, file: dest, rawRows: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [], sha256: storage.sha256File(dest), from: path.basename(file) };
  log.info(`快照 ${legacyPrefix} <- ${path.basename(file)} -> ${path.basename(dest)}（${rows.length} 行）`);
  return res;
}

// 翻页抓全（复用 dxm 分页）
async function paginateAll(page, log, extractor, maxPages) {
  const all = [];
  let pageNo = 1, complete = true;
  while (true) {
    const rows = await extractor(page);
    all.push(...rows);
    if (pageNo >= (maxPages || DXM_CFG.maxPages)) { complete = false; log.warn('达到 maxPages 上限，未取全'); break; }
    const nx = await dxm.goNextPage(page, log);
    if (nx !== 'CLICKED') break;
    await dxm.sleep(DXM_CFG.waitAfterNextMs + 1500);
    pageNo++;
  }
  return { rows: all, complete, pages: pageNo };
}

// 从行的 时间 列提取「实际覆盖的自然日」，限定在 [from,to] 窗口内
function coveredDaysFromRows(rows, fromDate, toDate) {
  const set = new Set();
  for (const r of rows) {
    const m = String(r['时间'] || '').match(/(\d{4}-\d{2}-\d{2})/);
    if (m && m[1] >= fromDate && m[1] <= toDate) set.add(m[1]);
  }
  return [...set].sort();
}

(async () => {
  const log = out.makeLogger(path.join(CFG.dataRoot, 'logs'));
  const startedAt = new Date();
  const windows = tw.purchaseWindows(startedAt);
  const stamp = tw.stamp(startedAt);
  const dateStr = windows.decisionDate;
  const rawDayDir = storage.rawDay(CFG.dataRoot, dateStr);

  log.step('=== C6R 采购数据抓取开始 ' + startedAt.toISOString() + ' ===');
  log.info('决策日=' + windows.decisionDate + ' 数据截止=' + windows.dataCutoff + ' 销量窗口=' + windows.last30[0] + '~' + windows.salesEnd);
  log.info('出入记录窗口=' + windows.entryExit.from + ' ~ ' + windows.entryExit.to + `（${windows.entryExit.days}天）`);
  log.info('raw 目录=' + rawDayDir);

  if (argv.dry) { log.step('--dry：仅计算窗口，不采集'); log.flush(); process.exit(0); }

  const taskResults = [];
  const writeOps = []; // C6：应始终为空
  let entryExitCoveredDays = null; // 任务05 实测覆盖的自然日

  // ===== 任务 01 / 02：纳物两店官方仓 =====
  if (want('01') || want('02') || want('nawu')) {
    if (argv.noNawu) {
      log.warn('--no-nawu：跳过纳物侧');
    } else {
      const ok = runChild(['nawu-daily-fetch.cjs'], log);
      if (ok) {
        for (const [id, legacy, snap, name] of [
          ['01', 'nawu-1店-inventory-latest', 'nawu-1店-inventory-latest', '纳物1店官方仓'],
          ['02', 'nawu-2店-inventory-latest', 'nawu-2店-inventory-latest', '纳物2店官方仓'],
        ]) {
          if (!want(id)) continue;
          const r = snapshotLegacy(CFG.outputDir, legacy, rawDayDir, snap, stamp, name, log);
          taskResults.push({
            id, name, pagePath: CFG.nawu.pagePath, ok: r.ok, file: r.file, error: r.error,
            capturedAt: new Date().toISOString(), coverageFrom: windows.last30[0], coverageTo: windows.salesEnd,
            rawRows: r.rawRows || 0, columns: r.columns || [], sha256: r.sha256,
            uniqueSku: r.rawRows ? uniqueSku(out.readTable(r.file).rows, '货品编码') : null,
            paginationComplete: true, status: r.ok ? 'ok' : 'failed',
            missingFields: [],
          });
        }
      } else {
        for (const id of ['01', '02']) if (want(id)) taskResults.push({ id, name: id === '01' ? '纳物1店官方仓' : '纳物2店官方仓', ok: false, error: 'nawu-daily-fetch 未成功', status: 'failed' });
      }
    }
  }

  // ===== 任务 03 / 04：店小秘仓库清单 / 商品管理 =====
  let skuMapReport = null;
  if ((want('03') || want('04')) && !argv.noDxm) {
    const legacyR = {};
    for (const [id, target, snap, name, pageKey] of [
      ['03', 'warehouseProduct', 'dxm-warehouseProduct-latest', '店小秘仓库清单', 'warehouseProduct'],
      ['04', 'product', 'dxm-product-latest', '店小秘商品管理', 'product'],
    ]) {
      if (!want(id)) continue;
      const ok = runChild(['dxm-fetch.cjs', '--target', target], log);
      const r = ok ? snapshotLegacy(CFG.outputDir, snap, rawDayDir, snap, stamp, name, log) : { ok: false, error: 'dxm-fetch --target ' + target + ' 未成功' };
      if (r.ok) legacyR[id] = r.file;
      taskResults.push({
        id, name, pagePath: DXM_CFG.targets[pageKey].pageUrl, ok: r.ok, file: r.file, error: r.error,
        capturedAt: new Date().toISOString(), rawRows: r.rawRows || 0, columns: r.columns || [], sha256: r.sha256,
        uniqueSku: r.ok ? uniqueSku(out.readTable(r.file).rows, '商品SKU') : null,
        paginationComplete: r.ok, status: r.ok ? 'ok' : 'failed',
        zeroOrNegativeKept: true, missingFields: [],
      });
    }

    // ===== 缺口3：类型页签 + 仓库清单属性补齐（一律另存结果，绝不改原始文件）=====
    if (want('03') && want('04') && legacyR['03'] && legacyR['04']) {
      try {
        const enrich = require('./lib/enrich.cjs');
        const wh = out.readTable(legacyR['03']).rows || [];
        const pd = out.readTable(legacyR['04']).rows || [];
        let typeBySku = {}, flagBySku = {}, typeDiag = null, typeAvailable = false;

        // 商品类型：点互斥类型页签枚举（组合/多变种/加工/有异常）
        try {
          const conn = await dxm.connectDxm(DXM_CFG.cdpUrl, log);
          const p = await conn.ctx.newPage();
          const tm = await c6r.collectProductTypeMap(p, DXM_CFG.targets.product.pageUrl, log);
          await p.close().catch(() => {});

          // 多变种行只给「商品编码」→ 用 商品管理 的 编码→SKU 索引回填
          const skuByCode = new Map();
          for (const r of pd) {
            const c = String(r['商品编码'] || '').trim();
            const s = String(r['商品SKU'] || '').trim();
            if (c && s && !skuByCode.has(c)) skuByCode.set(c, s);
          }
          const resolve = (rec) => rec.商品SKU || skuByCode.get(String(rec.商品编码 || '').trim()) || '';
          const missCode = [];
          for (const t of ['组合', '多变种', '加工']) {
            for (const rec of (tm.lists[t] || [])) {
              const sku = resolve(rec);
              if (!sku) { missCode.push({ 类型: t, 商品编码: rec.商品编码, 商品SKU: rec.商品SKU }); continue; }
              if (!typeBySku[sku]) typeBySku[sku] = t;
            }
          }
          for (const rec of (tm.lists['有异常'] || [])) { const sku = resolve(rec); if (sku) flagBySku[sku] = '有异常'; }

          // 一致性校验：
          //   enumerationComplete = 每个类型页签「声明数 == 实得数」
          //   singlesClosed       = 把「非组合/多变种/加工」默认成单品后，单品总数是否与页面声明闭合
          // 只有两者都成立才允许把剩余 SKU 标为「单品」；否则记 UNKNOWN（不猜）。
          const declaredOthers = (tm.declared['组合'] || 0) + (tm.declared['多变种'] || 0) + (tm.declared['加工'] || 0);
          const declaredAll = tm.counts['全部'] || pd.length;
          const expectedSingles = declaredAll - declaredOthers;
          const actualSingles = pd.length - Object.keys(typeBySku).length;
          const singlesClosed = actualSingles === expectedSingles;
          const enumerationComplete = tm.complete;
          // 判据核心是**算术闭合**：若「非组合/多变种/加工」的行数恰等于页面声明的单品数，
          // 则剩余每一行确为单品。多变种树形父行(10000x)无 SKU、本就不在产品清单里，
          // 因此不可映射项只作为**提示信息**记录，不阻断单品归类。
          typeAvailable = enumerationComplete && singlesClosed;

          // 不可映射项（如多变种列表只给内部识别码、无 SKU）→ 独立明细，绝不静默丢弃
          let unresolvedFile = '';
          if (missCode.length) {
            const u = storage.writeSnapshot(rawDayDir, 'dxm-product-type-unresolved', stamp, missCode, '类型不可映射', ['类型', '商品编码', '商品SKU']);
            unresolvedFile = path.basename(u.xlsxReal);
          }
          typeDiag = { declared: tm.declared, collected: tm.collected, counts: tm.counts, expectedSingles, actualSingles, singlesClosed, enumerationComplete, unresolved: missCode.length, unresolvedDetailFile: unresolvedFile, consistent: typeAvailable };
          if (!typeAvailable) log.warn(`类型枚举未闭合（${JSON.stringify({ enumerationComplete, singlesClosed })}）→ 未识别 SKU 的商品类型记 UNKNOWN（不猜）；不可映射行：${unresolvedFile || '无'}`);
          else log.info(`类型枚举闭合：已识别 ${Object.keys(typeBySku).length}，单品推定 ${actualSingles}，不可映射父行 ${missCode.length}（明细 ${unresolvedFile || '无'}）`);

          const allSku = [...new Set(pd.map((x) => String(x['商品SKU'] || '').trim()).filter(Boolean))];
          const typeRows = allSku.map((s) => ({ 商品SKU: s, 商品类型: typeBySku[s] || (typeAvailable ? '单品' : 'UNKNOWN'), 有异常: flagBySku[s] || '' }));
          storage.writeSnapshot(rawDayDir, 'dxm-product-type', stamp, typeRows, '商品类型', ['商品SKU', '商品类型', '有异常']);
        } catch (e) {
          log.warn('类型页签采集失败（降级：商品类型记 UNKNOWN，不猜）：' + e.message);
        }

        const res = enrich.enrichWarehouse(wh, pd, { typeBySku, flagBySku, typeAvailable });
        const cols = enrich.enrichedColumns(wh[0] ? Object.keys(wh[0]) : null);
        const en = storage.writeSnapshot(rawDayDir, 'dxm-warehouseProduct-enriched', stamp, res.rows, '仓库清单-属性补齐', cols);
        let unFile = '';
        if (res.unmatched.length) {
          const u = storage.writeSnapshot(rawDayDir, 'dxm-warehouse-sku-unmatched', stamp, res.unmatched, '未匹配SKU', ['商品SKU', '商品编码', '仓库位置', '货架位', '商品名称']);
          unFile = path.basename(u.xlsxReal);
        }
        const t03 = taskResults.find((t) => t.id === '03');
        if (t03) t03.enrich = { file: en.xlsxReal, sha256: en.sha256, ...res.stats, typeDiag, typeAvailable };
        skuMapReport = {
          exact: res.stats.matched, alias: 0,
          anomalies: res.stats.unmatched + res.stats.conflicts,
          anomaliesDetailed: true,
          detailFile: unFile || (res.stats.conflicts ? 'conflicts(inline)' : ''),
        };
        log.step(`缺口3 属性补齐：命中 ${res.stats.matched}/${res.stats.total}｜类型${typeAvailable ? '已校验' : 'UNKNOWN'}｜未匹配 ${res.stats.unmatched}｜冲突 ${res.stats.conflicts}`);
      } catch (e) { log.warn('仓库清单属性补齐失败（非阻断）：' + e.message); }
    }
  }

  // ===== 任务 05 / 06 / 07：店小秘新页面（CDP 直采）=====
  const needDxmPages = (want('05') || want('06') || want('07')) && !argv.noDxm;
  if (needDxmPages) {
    let ctx = null, page = null;
    try {
      const conn = await dxm.connectDxm(DXM_CFG.cdpUrl, log);
      ctx = conn.ctx; page = await ctx.newPage();
    } catch (e) { log.error('店小秘 CDP 连接失败：' + e.message); }

    if (page) {
      // --- 任务05 出入记录 35 天 ---
      if (want('05')) {
        let r = { ok: false };
        try {
          const login = await dxm.ensureLoggedInAt(page, DXM_CFG.targets.entryExit.pageUrl, log);
          if (!login.ok) throw new Error(login.reason);
          await dxm.waitForTable(page, log);
          // 窗口采集（单一真相源 lib/dxm-c6r.collectEntryExitWindow）：
          //   切「时间=全部」→ 倒序翻页早停 → 截断到 35 天窗口。
          //   页面默认时间筛选仅约 7 天，不得直读默认视图（2026-10-12 G2 阻塞根因）。
          const fromDate = windows.entryExit.from.slice(0, 10);
          const toDate = windows.entryExit.to.slice(0, 10);
          const res = await c6r.collectEntryExitWindow(page, {
            fromDate, toDate, extractor: (p) => dxm.extractEntryExitRows(p),
            goNextPage: (p, l) => dxm.goNextPage(p, l), sleep: dxm.sleep,
            maxPages: DXM_CFG.maxPages, waitAfterNextMs: DXM_CFG.waitAfterNextMs,
          }, log);
          const inWindow = res.rows;
          const columns = c6r.ENTRYEXIT_COLUMNS;
          const snap = storage.writeSnapshot(rawDayDir, 'dxm-entryexit-35d', stamp, inWindow, '出入记录35天', columns);
          // 同步刷新 legacy latest（供 ChatGPT 上传路径沿用；仍属原始数据仓库）
          out.writeCsv(path.join(CFG.outputDir, 'dxm-entryexit-latest.csv'), inWindow, columns);
          out.writeXlsx(path.join(CFG.outputDir, 'dxm-entryexit-latest.xlsx'), inWindow, '出入记录');
          entryExitCoveredDays = res.coveredDays.length ? res.coveredDays : coveredDaysFromRows(inWindow, fromDate, toDate);
          r = { ok: true, file: snap.xlsxReal, rawRows: inWindow.length, columns, sha256: snap.sha256, scanned: res.scanned, paginationComplete: res.complete || res.reachedBoundary, uniqueSku: uniqueSku(inWindow, '商品信息') };
          log.step(`任务05 出入记录：筛选=${res.filterMode}｜扫描 ${res.scanned} 行 -> 窗口内 ${inWindow.length} 行（覆盖 ${entryExitCoveredDays.length} 个自然日，早停=${res.reachedBoundary}）`);
        } catch (e) { r = { ok: false, error: e.message }; log.error('任务05 失败：' + e.message); }
        taskResults.push({ id: '05', name: '店小秘出入记录(35天)', pagePath: DXM_CFG.targets.entryExit.pageUrl, capturedAt: new Date().toISOString(), coverageFrom: windows.entryExit.from, coverageTo: windows.entryExit.to, ...r, status: r.ok ? 'ok' : 'failed', missingFields: [] });
      }

      // --- 任务06 采购订单（URL 视图导航 + 分页）---
      if (want('06')) {
        let r = { ok: false };
        try {
          const views = DXM_CFG.targets.purchaseOrder.views || [];
          const all = [];
          let allComplete = true;
          for (const v of views) {
            const login = await dxm.ensureLoggedInAt(page, v.url, log);
            if (!login.ok) { log.warn(`采购订单[${v.name}] 跳过：${login.reason}`); continue; }
            await dxm.waitForTable(page, log).catch(() => {});
            const got = await paginateAll(page, log, c6r.extractPurchaseOrderRows);
            if (!got.complete) allComplete = false;
            const fromDate = windows.entryExit.from.slice(0, 10);
            const toDate = windows.entryExit.to.slice(0, 10);
            let rows = got.rows.map((x) => ({ 视图: v.name, ...x }));
            if (v.windowDays) {
              rows = rows.filter((x) => { const m = String(x['创建时间'] || '').match(/(\d{4}-\d{2}-\d{2})/); return !m || (m[1] >= fromDate && m[1] <= toDate); });
              log.info(`采购订单[${v.name}] 页签 ${got.rows.length} -> 35天窗口内 ${rows.length}`);
            }
            all.push(...rows);
            log.info(`采购订单[${v.name}] ${rows.length} 行（分页 ${got.pages} 页，complete=${got.complete}）`);
          }
          const columns = ['视图', '采购单号', '供货商', '仓库', '采购员', '商品种类', '采购数量', '货款', '到货货款', '物流', '创建时间', '到货时间', '更新时间', '状态'];
          const snap = storage.writeSnapshot(rawDayDir, 'dxm-purchaseOrders-open', stamp, all, '采购订单', columns);
          r = { ok: all.length > 0, file: snap.xlsxReal, rawRows: all.length, columns, sha256: snap.sha256, hasSkuLevel: false, openCount: all.length, paginationComplete: allComplete, note: '整单行；SKU级未到货明细需从采购详情补充（商品信息列需展开）' };
          log.step(`任务06 采购订单：${all.length} 行（视图 ${views.length} 个）`);
        } catch (e) { r = { ok: false, error: e.message }; log.error('任务06 失败：' + e.message); }
        taskResults.push({ id: '06', name: '店小秘采购订单', pagePath: DXM_CFG.targets.purchaseOrder.pageUrl, capturedAt: new Date().toISOString(), coverageFrom: windows.entryExit.from, coverageTo: windows.entryExit.to, ...r, status: r.ok ? 'ok' : 'failed', missingFields: ['SKU级未到货数量'], unmatchedSkuExcluded: null });
      }

      // --- 任务07 供货商 + 供货关系（分页）---
      if (want('07')) {
        let r = { ok: false };
        try {
          const supRows = [];
          const log2 = await dxm.ensureLoggedInAt(page, DXM_CFG.targets.supplier.pageUrl, log);
          if (log2.ok) {
            await dxm.waitForTable(page, log).catch(() => {});
            for (const tab of (DXM_CFG.targets.supplier.tabs || ['普通供货商'])) {
              await c6r.clickText(page, tab).catch(() => {});
              await dxm.sleep(3500);
              const got = await paginateAll(page, log, c6r.extractSupplierRows);
              got.rows.forEach((x) => supRows.push({ 供货商类型: tab, ...x }));
              log.info(`供货商[${tab}] ${got.rows.length} 行（分页 ${got.pages} 页）`);
            }
          }
          const relRows = [];
          const log3 = await dxm.ensureLoggedInAt(page, DXM_CFG.targets.supplyRelation.pageUrl, log);
          if (log3.ok) {
            await dxm.waitForTable(page, log).catch(() => {});
            const got = await paginateAll(page, log, c6r.extractSupplyRelationRows);
            relRows.push(...got.rows);
            log.info(`供货关系 ${relRows.length} 行（分页 ${got.pages} 页）`);
          }
          const colSup = ['供货商类型', '供货商名称', '结算方式', '延时率', '补货率', '退货率', '换货率', '次品率', '供货时效', '创建时间', '更新时间'];
          const colRel = ['供货商名称', '供货商品数', '采购次数', '延时率', '补货率', '退货率', '换货率', '次品率', '供货时效', '最近交易时间'];
          const masterPath = storage.masterDir(CFG.dataRoot);
          const supSnap = storage.writeSnapshot(masterPath, 'nawu-supplier', stamp, supRows, '供货商', colSup);
          const relSnap = storage.writeSnapshot(masterPath, 'nawu-supply-relation', stamp, relRows, '供货关系', colRel);
          r = { ok: supRows.length + relRows.length > 0, file: supSnap.xlsxReal, files: { supplier: supSnap.xlsxReal, relation: relSnap.xlsxReal }, rawRows: supRows.length + relRows.length, columns: colSup, sha256: supSnap.sha256, uniqueSku: supRows.length };
          log.step(`任务07 主数据：供货商 ${supRows.length} 行 / 供货关系 ${relRows.length} 行`);
        } catch (e) { r = { ok: false, error: e.message }; log.error('任务07 失败：' + e.message); }
        taskResults.push({ id: '07', name: 'SKU/供货商主数据', pagePath: DXM_CFG.targets.supplier.pageUrl, capturedAt: new Date().toISOString(), ...r, status: r.ok ? 'ok' : 'failed', missingFields: ['本地资金层级/BOM/LT（店小秘无此字段，须从本地主数据补）'] });
      }

      await page.close().catch(() => {});
    }
  }

  // ===== 门禁 + manifest =====
  const requiredIds = (CFG.requiredTaskIds || ['01', '02', '03', '04', '05', '06', '07']).filter(want);
  const coverageMap = entryExitCoveredDays ? { coveredDays: entryExitCoveredDays } : { coveredDays: windows.last30.slice() };
  const gateRes = gates.runAllGates({ taskResults, requiredIds, coverageMap, windows, writeOps, skuMapReport });

  const manifest = buildManifest({
    taskDate: dateStr, windows, taskResults, gates: gateRes,
    generatedAt: new Date().toISOString(),
  });
  const mfFile = storage.writeManifest(CFG.dataRoot, dateStr, manifest);

  log.step('--- 门禁结果 ---');
  for (const g of gateRes.gates) log.info(`${g.pass ? 'PASS' : 'FAIL'} ${g.code} ${g.name} :: ${g.detail}`);
  log.step(`manifest -> ${mfFile}（${manifest.summary.ok}/${manifest.summary.total} 任务成功）`);
  log.step('=== C6R 抓取结束 status=' + (gateRes.pass ? 'PASS' : 'PARTIAL') + ' ===');
  log.flush();
  process.exit(gateRes.pass ? 0 : 4);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
