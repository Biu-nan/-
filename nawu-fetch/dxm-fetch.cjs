#!/usr/bin/env node
// 店小秘 多清单统一采集（P2）
// 用法：
//   node dxm-fetch.cjs --target warehouseProduct   仓库清单（已有）
//   node dxm-fetch.cjs --target product             商品管理
//   node dxm-fetch.cjs --target entryExit          自营仓库出入记录（最近 35 个完整自然日窗口）
//   node dxm-fetch.cjs --target entryExit --pages 3 只抓前 3 页（调试：跳过窗口采集，按页面原样分页）
//   node dxm-fetch.cjs --target product --probe     仅抓第 1 页不落盘
//   node dxm-fetch.cjs --target entryExit --pages 3 只抓前 3 页
// 注意：本机 shell 设了 http_proxy，会劫持 localhost 请求，必须在加载任何网络库之前清掉
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const dxm = require('./lib/dxm-warehouse.cjs');
const c6r = require('./lib/dxm-c6r.cjs');
const tw = require('./lib/timewindow.cjs');
const out = require('./lib/output.cjs');

const CFG_PATH = path.join(__dirname, 'dxm-config.json');
const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));

const COLUMNS = {
  warehouseProduct: ['来源', '商品SKU', '商品名称', '商品编码', '分类', '仓库位置', '货架位', '安全库存', '在途', '未发', '占用', '可用', '总量', '单价CNY', '总价CNY', '时间'],
  product: ['来源', '商品SKU', '商品名称', '商品编码', '分类', '参考价CNY', '重量g', '尺寸cm', '状态', '创建时间', '更新时间'],
  entryExit: c6r.ENTRYEXIT_COLUMNS,
};

const EXTRACTORS = {
  warehouseProduct: (page) => dxm.extractRows(page),
  product: (page) => dxm.extractProductRows(page),
  entryExit: (page) => dxm.extractEntryExitRows(page),
};

function parseArgs(argv) {
  const a = { target: 'warehouseProduct', probe: false, pages: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--target') a.target = argv[++i] || a.target;
    else if (argv[i] === '--probe') a.probe = true;
    else if (argv[i] === '--pages') a.pages = parseInt(argv[++i] || '0', 10) || null;
  }
  return a;
}

(async () => {
  const argv = parseArgs(process.argv);
  const t = cfg.targets[argv.target];
  if (!t) { console.error('未知 target：' + argv.target + '；可选：' + Object.keys(cfg.targets).join(', ')); process.exit(1); }

  const log = out.makeLogger(cfg.outputDir);
  const startedAt = new Date();
  log.step(`=== 店小秘 [${argv.target}] 采集开始 ${startedAt.toISOString()} ===`);

  const { ctx } = await dxm.connectDxm(cfg.cdpUrl, log);
  const page = await ctx.newPage();

  const login = await dxm.ensureLoggedInAt(page, t.pageUrl, log);
  if (!login.ok) { log.error('登录检查失败：' + login.reason); log.flush(); process.exit(1); }

  await dxm.waitForTable(page, log);
  const pg = await dxm.getPagination(page);
  log.info(`分页信息：总数 ${pg.total}（按「下一页」可用即续，上限 ${cfg.maxPages} 页）`);

  const extractor = EXTRACTORS[argv.target];
  const all = [];

  if (argv.target === 'entryExit' && !argv.probe && !argv.pages) {
    // ⚠ 页面「时间」筛选默认只约 7 天；直读默认视图会导致 30 日 P95 窗口覆盖不足，
    //   触发采购侧 G2「数据时效与覆盖」门禁阻塞（2026-10-12 实际发生）。
    //   因此走共享的窗口采集：切「时间=全部」→ 倒序早停 → 截断到最近 35 个完整自然日。
    const w = tw.purchaseWindows(new Date()).entryExit;
    const fromDate = w.from.slice(0, 10);
    const toDate = w.to.slice(0, 10);
    log.info(`出入记录窗口 = ${fromDate} ~ ${toDate}（${w.days} 天，含所需 30 日 P95 窗口）`);
    const res = await c6r.collectEntryExitWindow(page, {
      fromDate, toDate, extractor, goNextPage: dxm.goNextPage, sleep: dxm.sleep,
      maxPages: cfg.maxPages, waitAfterNextMs: cfg.waitAfterNextMs,
    }, log);
    all.push(...res.rows);
    log.step(`出入记录窗口采集：时间筛选=${res.filterMode}｜扫描 ${res.scanned} 行 -> 窗口内 ${all.length} 行（早停=${res.reachedBoundary}，分页 ${res.pages} 页，覆盖 ${res.coveredDays.length} 个自然日）`);
    if (res.coveredDays.length < 30) {
      log.warn(`⚠ 出入记录仅覆盖 ${res.coveredDays.length} 个自然日（<30）→ 30 日 P95 窗口不足，采购门禁将阻塞；请确认「时间=全部」是否生效`);
    }
  } else {
    let pageNo = 1;
    while (true) {
      if (argv.pages && pageNo > argv.pages) break;
      const rows = await extractor(page);
      log.info(`第 ${pageNo} 页：解析 ${rows.length} 行（累计 ${all.length + rows.length}）`);
      all.push(...rows);
      if (argv.probe) { log.info('probe 模式：首行样例 ' + JSON.stringify(rows[0] || {})); break; }
      if (pageNo >= cfg.maxPages) { log.warn('已达 maxPages 上限，停止'); break; }
      const next = await dxm.goNextPage(page, log);
      if (next !== 'CLICKED') { log.warn('翻页结束（next=' + next + '）'); break; }
      await dxm.sleep(cfg.waitAfterNextMs + 1500);
      pageNo++;
    }
  }

  if (argv.probe) { log.step('=== 采集结束（probe）==='); log.flush(); process.exit(0); }
  if (!all.length) { log.error('未解析到任何行，终止'); log.flush(); process.exit(1); }

  const columns = COLUMNS[argv.target];
  const jsonPath = path.join(cfg.outputDir, t.outputPrefix + '-latest.json');
  const csvPath = path.join(cfg.outputDir, t.outputPrefix + '-latest.csv');
  const xlsxPath = path.join(cfg.outputDir, t.outputPrefix + '-latest.xlsx');
  const jsonPayload = { source: t.outputPrefix, fetchedAt: new Date().toISOString(), schemaVersion: 1, total: all.length, columns, rows: all };
  out.writeJson(jsonPath, jsonPayload);
  out.writeCsv(csvPath, all, columns);
  const realXlsx = out.writeXlsx(xlsxPath, all, t.sheetName || argv.target);
  if (realXlsx !== xlsxPath) log.warn(`xlsx 目标被占用锁定，已另存为：${path.basename(realXlsx)}（关闭 Excel 中的旧表后重跑可覆盖原名）`);
  log.step(`落盘完成：${path.basename(jsonPath)} / ${path.basename(csvPath)} / ${path.basename(realXlsx)}；共 ${all.length} 行`);
  log.flush();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
