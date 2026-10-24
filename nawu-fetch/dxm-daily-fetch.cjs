#!/usr/bin/env node
// 店小秘 仓库清单 每日采集（P2）
// 用法：
//   node dxm-daily-fetch.cjs              全量抓取并落盘
//   node dxm-daily-fetch.cjs --probe      只抓第 1 页并 dump 行数/样例，不落盘
//   node dxm-daily-fetch.cjs --pages 2    只抓前 2 页（调试）
// 注意：本机 shell 设了 http_proxy，会劫持 localhost 请求，必须在加载任何网络库之前清掉
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const dxm = require('./lib/dxm-warehouse.cjs');
const out = require('./lib/output.cjs');

const CFG_PATH = path.join(__dirname, 'dxm-config.json');
const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));

function parseArgs(argv) {
  const a = { probe: false, pages: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--probe') a.probe = true;
    else if (argv[i] === '--pages') a.pages = parseInt(argv[++i] || '0', 10) || null;
  }
  return a;
}
const argv = parseArgs(process.argv);

(async () => {
  const log = out.makeLogger(cfg.outputDir);
  const startedAt = new Date();
  log.step('=== 店小秘 仓库清单采集开始 ' + startedAt.toISOString() + ' ===');

  const { ctx } = await dxm.connectDxm(cfg.cdpUrl, log);
  const page = await ctx.newPage();

  const login = await dxm.ensureLoggedIn(page, log);
  if (!login.ok) {
    log.error('登录检查失败：' + login.reason);
    log.flush();
    process.exit(1);
  }

  await page.waitForSelector('.vxe-body--row', { timeout: 30000 }).catch(() => {});
  const pg = await dxm.getPagination(page);
  const totalPages = Math.min(cfg.maxPages, Math.ceil((pg.total || 0) / 100) || cfg.maxPages);
  log.info(`分页信息：总数 ${pg.total}，预计 ${totalPages} 页`);

  const all = [];
  let pageNo = 1;
  while (true) {
    if (argv.pages && pageNo > argv.pages) break;
    const rows = await dxm.extractRows(page);
    log.info(`第 ${pageNo} 页：解析 ${rows.length} 行（累计 ${all.length + rows.length}）`);
    all.push(...rows);
    if (argv.probe) {
      log.info('probe 模式：仅首行样例 ' + JSON.stringify(rows[0] || {}));
      break;
    }
    if (pageNo >= totalPages) break;
    const next = await dxm.goNextPage(page, log);
    if (next !== 'CLICKED') {
      log.warn('翻页结束（next=${next}）');
      break;
    }
    await dxm.sleep(cfg.waitAfterNextMs + 1500);
    pageNo++;
  }

  if (argv.probe) {
    log.step('=== 采集结束（probe）===');
    log.flush();
    process.exit(0);
  }

  if (!all.length) {
    log.error('未解析到任何行，终止');
    log.flush();
    process.exit(1);
  }

  // 落盘
  const jsonPath = path.join(cfg.outputDir, cfg.outputPrefix + '-latest.json');
  const csvPath = path.join(cfg.outputDir, cfg.outputPrefix + '-latest.csv');
  const xlsxPath = path.join(cfg.outputDir, cfg.outputPrefix + '-latest.xlsx');
  const columns = ['来源', '商品SKU', '商品名称', '商品编码', '分类', '仓库位置', '货架位', '安全库存', '在途', '未发', '占用', '可用', '总量', '单价CNY', '总价CNY', '时间'];

  const jsonPayload = {
    source: 'dxm-warehouseProduct',
    fetchedAt: new Date().toISOString(),
    schemaVersion: 1,
    total: all.length,
    columns,
    rows: all,
  };
  out.writeJson(jsonPath, jsonPayload);
  out.writeCsv(csvPath, all, columns);
  out.writeXlsx(xlsxPath, all, '仓库清单');
  log.step(`落盘完成：${path.basename(jsonPath)} / ${path.basename(csvPath)} / ${path.basename(xlsxPath)}；共 ${all.length} 行`);
  log.flush();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
