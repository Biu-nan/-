#!/usr/bin/env node
// 纳物每日采购数据采集 · P1（纳物侧）
// 用法：
//   node nawu-daily-fetch.cjs                     全量跑（筛出「纳物」店铺）
//   node nawu-daily-fetch.cjs --store 416488      只跑指定店铺
//   node nawu-daily-fetch.cjs --probe             只打开页面并 dump 元信息，不导出、不落盘
//   node nawu-daily-fetch.cjs --probe-export      只打开导出弹窗并 dump radio 结构
//   node nawu-daily-fetch.cjs --keep-open         跑完不关闭店铺浏览器
//   node nawu-daily-fetch.cjs --fallback-dom      导出失败时降级为按页抓 DOM
// 注意：本机 shell 设了 http_proxy，会劫持 localhost 请求，必须在加载任何网络库之前清掉
delete process.env.http_proxy;
delete process.env.HTTP_PROXY;
delete process.env.https_proxy;
delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { WenmaiApi } = require('./lib/wenmai-api.cjs');
const inv = require('./lib/nawu-inventory.cjs');
const out = require('./lib/output.cjs');

const CFG_PATH = path.join(__dirname, 'config.json');
const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));

function parseArgs(argv) {
  const a = { probe: false, probeExport: false, keepOpen: false, fallbackDom: false, stores: null };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--probe') a.probe = true;
    else if (t === '--probe-export') a.probeExport = true;
    else if (t === '--keep-open') a.keepOpen = true;
    else if (t === '--fallback-dom') a.fallbackDom = true;
    else if (t === '--store') a.stores = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return a;
}

// channelId 解析：channelIdMap 显式配置优先，其次从门户落地 URL 自动提取
function resolveChannelId(store, page, cfg, log) {
  const map = cfg.channelIdMap || {};
  if (map[String(store.id)]) return String(map[String(store.id)]);
  const m = (page.url() || '').match(/[?&]channelId=(\d+)/);
  if (m) {
    log.info(`[${store.id}] 从门户 URL 自动解析 channelId=${m[1]}`);
    return m[1];
  }
  return null;
}

const argv = parseArgs(process.argv);

(async () => {
  const log = out.makeLogger(cfg.logDir);
  const startedAt = new Date();
  log.step('=== 纳物侧采集开始 ' + startedAt.toISOString() + ' ===');

  const api = new WenmaiApi(cfg.wenmaiApi, cfg.apiMinIntervalMs);
  const alerts = [];
  const storeResults = [];

  // 1. 稳卖 API 自检
  const chk = await api.selfCheck();
  log.info('稳卖 API 自检: ' + JSON.stringify(chk.endpoints));
  if (!chk.reachable) {
    log.error('稳卖 API 不可达，终止：' + chk.error);
    log.flush();
    process.exit(1);
  }

  // 2. 取店铺清单并筛选
  const all = await api.listAllStores();
  log.info(`店铺总数 ${all.total}`);
  let targets = all.envs;
  if (argv.stores && argv.stores.length) {
    targets = all.envs.filter((s) => argv.stores.includes(String(s.id)));
  } else {
    const re = new RegExp(cfg.storeFilter.includeNameRegex);
    const explicit = cfg.storeFilter.explicitIds || [];
    targets = all.envs.filter((s) => re.test(s.name || '') || explicit.includes(s.id));
  }
  log.info('目标店铺: ' + JSON.stringify(targets.map((s) => `${s.id}:${s.name}`)));
  if (!targets.length) {
    log.error('筛选后没有目标店铺，终止');
    log.flush();
    process.exit(1);
  }

  const collected = [];

  // 3. 逐店铺采集
  for (const store of targets) {
    const tag = `[${store.id}] ${store.name}`;
    log.step('--- 处理 ' + tag + ' ---');
    let opened = null;
    let ctx = null;
    let page = null;
    try {
      opened = await api.openEnv(store.id, 'default');
      log.info(`${tag} openEnv ok pid=${opened.pid} cdpPort=${opened.cdpPort}`);
      if (!opened.cdpPort) throw new Error('openEnv 未返回可用端口: ' + JSON.stringify(opened.raw));

      const conn = await inv.connectStore(opened.cdpPort, log);
      ctx = conn.ctx;
      page = await ctx.newPage();

      // 登录态保障
      const login = await inv.ensureLoggedIn(page, cfg, log);
      if (!login.ok) throw new Error('登录失败: ' + login.reason);
      log.info(tag + ' 登录态 ok (' + login.action + ')');

      // 进入实时库存明细（channelId 每店不同，不能复用别家的）
      const tab = await inv.openRealtimeTab(page, cfg, log, resolveChannelId(store, page, cfg, log));
      if (!tab.ok) throw new Error('进入库存页失败: ' + tab.reason);

      if (argv.probe) {
        log.info(`${tag} [probe 模式] 页面元信息: ` + JSON.stringify(tab.meta));
        storeResults.push({ store, ok: true, mode: 'probe', meta: tab.meta });
        continue;
      }

      if (argv.probeExport) {
        const started = await inv.exportInventory(page, cfg, log, cfg.rawDir);
        log.info(`${tag} [probe-export] 结果: ` + JSON.stringify(started));
        storeResults.push({ store, ok: started.ok, mode: 'probe-export', raw: started });
        continue;
      }

      // 导出
      const exp = await inv.exportInventory(page, cfg, log, cfg.rawDir);
      let rows = [];
      let source = 'export';
      if (exp.ok) {
        const table = out.readTable(exp.file);
        rows = table.rows;
        log.info(`${tag} 导出解析完成：sheet=${table.sheetName} rows=${rows.length}`);
      } else {
        log.warn(`${tag} 导出失败：${exp.reason}`);
        if (argv.fallbackDom || (cfg.fallback && cfg.fallback.enableDomScrape)) {
          source = 'dom-fallback';
          rows = await inv.scrapeByDom(page, cfg, log);
          log.warn(`${tag} 降级 DOM 抓取得到 ${rows.length} 行（仅品维度，无分仓拆分）`);
        }
        alerts.push({ storeId: store.id, store: store.name, type: 'export-failed', detail: exp.reason });
      }

      if (!rows.length) throw new Error('未取到任何数据行');

      // 抽故障诊断截图
      const normalized = rows.map((r) => inv.normalizeRow(r, store));
      collected.push({ store, source, rows: normalized, rawRows: rows });
      storeResults.push({ store, ok: true, mode: source, rowCount: normalized.length });

      log.info(`${tag} 采集成功：${normalized.length} 行（source=${source}）`);
    } catch (e) {
      log.error(`${tag} 失败：${e.message}`);
      alerts.push({ storeId: store.id, store: store.name, type: 'fetch-failed', detail: e.message });
      storeResults.push({ store, ok: false, error: e.message });
      try {
        if (page) {
          const shot = path.join(cfg.logDir, `fail-${store.id}-${Date.now()}.png`);
          await page.screenshot({ path: shot, fullPage: false });
          log.warn(`${tag} 已保存失败截图 ${shot}`);
        }
      } catch (e2) {
        /* 截图失败忽略 */
      }
    } finally {
      try {
        if (page) await page.close();
      } catch (e) {
        /* ignore */
      }
      const keep = argv.keepOpen || !cfg.closeStoreAfterRun;
      if (!keep && opened) {
        await api.closeEnv(store.id);
        log.info(`${tag} 已关闭店铺实例`);
      }
    }
  }

  // 4. 落盘（只有至少一个店铺成功才覆盖旧数据）
  const okStores = storeResults.filter((r) => r.ok);
  const meta = {
    source: 'nawu-inventory',
    fetchedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    elapsedMs: Date.now() - startedAt.getTime(),
    schemaVersion: 1,
    storeResults,
    alerts,
    status: alerts.length === 0 ? 'ok' : okStores.length ? 'partial' : 'failed',
    alertLevel: alerts.length >= 2 ? 'high' : alerts.length ? 'low' : 'none',
  };

  // 店铺标签：从店铺名提取「几店」→ 文件名前缀（如 "纳物-箱包全托1店" → nawu-1店）
  function storeLabel(store) {
    const m = (store.name || '').match(/(\d+)\s*店/);
    const no = m ? m[1] : String(store.id);
    return `nawu-${no}店`;
  }

  if (argv.probe || argv.probeExport) {
    log.info('probe 模式：不落盘');
  } else if (!collected.length) {
    log.error('全部店铺失败：保留旧数据不动');
    out.writeJson(path.join(cfg.outputDir, 'fetch-meta.json'), meta);
  } else {
    // JSON = 标准化行（含原始字段，供程序消费）
    // CSV / XLSX = 原始导出全字段（50 列保真，供采购直接看）
    const normRows = [];
    const rawRows = [];

    // ---- 分店铺落盘：每家店单独一套文件，以「几店」命名，表格彼此区分 ----
    for (const c of collected) {
      const label = storeLabel(c.store);
      const storeNorm = c.rows.slice();
      const storeRaw = c.rawRows.map((rr) => ({ 店铺: c.store.name, storeId: c.store.id, ...rr }));
      const p = (ext) => path.join(cfg.outputDir, `${label}-inventory-latest.${ext}`);
      out.writeJson(p('json'), {
        source: 'nawu-inventory',
        store: { id: c.store.id, name: c.store.name },
        fetchedAt: meta.fetchedAt,
        rowCount: storeNorm.length,
        rawRowCount: storeRaw.length,
        schemaVersion: 1,
        columns: storeNorm.length ? Object.keys(storeNorm[0]) : [],
        rows: storeNorm,
      });
      out.writeCsv(p('csv'), storeRaw);
      out.writeXlsx(p('xlsx'), storeRaw, label);
      log.step(`[${c.store.name}] 落盘：${label}-inventory-latest.{json,csv,xlsx}（标准化 ${storeNorm.length} 行 / 原始 ${storeRaw.length} 行）`);

      storeNorm.forEach((r) => normRows.push(r));
      storeRaw.forEach((r) => rawRows.push(r));
    }

    // ---- 合并汇总：保留一套全店合计（含 店铺 列），便于总览 ----
    const jsonPath = path.join(cfg.outputDir, 'nawu-inventory-latest.json');
    const csvPath = path.join(cfg.outputDir, 'nawu-inventory-latest.csv');
    const xlsxPath = path.join(cfg.outputDir, 'nawu-inventory-latest.xlsx');
    out.writeJson(jsonPath, {
      source: 'nawu-inventory',
      fetchedAt: meta.fetchedAt,
      rowCount: normRows.length,
      rawRowCount: rawRows.length,
      schemaVersion: 1,
      stores: collected.map((c) => ({ id: c.store.id, name: c.store.name, source: c.source, rowCount: c.rows.length })),
      rows: normRows,
    });
    out.writeCsv(csvPath, rawRows);
    out.writeXlsx(xlsxPath, rawRows, '纳物品仓库存');
    log.step(
      `合并汇总：${path.basename(jsonPath)} / ${path.basename(csvPath)} / ${path.basename(xlsxPath)}；共 ${collected.length} 店，标准化 ${normRows.length} 行，原始 ${rawRows.length} 行`
    );
    out.writeJson(path.join(cfg.outputDir, 'fetch-meta.json'), meta);
  }

  log.step('=== 采集结束 status=' + meta.status + ' ===');
  log.flush();
  process.exit(meta.status === 'failed' ? 2 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
