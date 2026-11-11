#!/usr/bin/env node
// 运营日更编排器（一键串起：抓取 → 建库 → 巡检 → 补货总览 → 摘要）
//
// 设计原则（继承稳卖客户端铁律）：
//   1. 稳卖 3980 的 openEnv 是**串行**的——多脚本并发会踩 websocket（"New request sent before
//      previous response received"）。故所有抓取**严格顺序**执行，绝不一把梭。
//   2. 抓取失败（如某店会话过期 NEEDS_MANUAL_LOGIN）只记录，不阻断后续与建库。
//   3. 建库 + 巡检 + 补货总览**永远执行**（即使浏览器离线，也是对现有数据的最新分析）。
//
// 用法：
//   node scripts/daily-ops-pipeline.mjs                  # 日更（店铺漏斗 + 商品级流量 + 建库 + 巡检）
//   node scripts/daily-ops-pipeline.mjs --full           # 全量（追加 商品销量/库存 + 指标采集）
//   node scripts/daily-ops-pipeline.mjs --offline        # 仅建库+巡检+摘要（不碰浏览器，适合复盘既有数据）
//   node scripts/daily-ops-pipeline.mjs --stores 400370,416488,461693
//   node scripts/daily-ops-pipeline.mjs --date 2026-11-10
//
// 退出码：0=正常；2=数据校验 FAIL（巡检未通过，结论不可信）

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const METRICS = path.join(ROOT, 'data', 'metrics');

const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const OFFLINE = argv.includes('--offline');
const SCRIPT_TIMEOUT_MS = 240000; // 单脚本硬上限；openEnv/页面卡死时强制回收，不拖垮整条链路
const DATE = (() => {
  const i = argv.indexOf('--date');
  // 北京日期（UTC+8）：toISOString() 取的是 UTC 日，北京时间 00:00–08:00 跑会写成前一天
  if (i > -1) return argv[i + 1];
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
})();
const storeArg = (() => {
  const i = argv.indexOf('--stores');
  if (i > -1) return argv[i + 1].split(',').map((s) => s.trim());
  return ['400370', '416488', '461693']; // 三个全托管店；pop 店 461692 不抓销量页
})();

const wenmaiReachable = () => {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: 3980, path: '/', timeout: 3000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function runScript(scriptRel, extraArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, scriptRel), ...extraArgs], {
      cwd: ROOT, env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      stderr += `\n[SCRIPT_TIMEOUT] ${scriptRel} 超过 ${SCRIPT_TIMEOUT_MS / 1000}s 被强制终止（疑似 openEnv/页面卡死）\n`;
      resolve({ code: 124, stdout, stderr, out: stdout + stderr, timedOut: true });
    }, SCRIPT_TIMEOUT_MS);
    // stdout/stderr 分开返回：JSON 解析必须只用 stdout，
    // 否则任何 stderr 告警都会让 JSON.parse 失败、把巡检 FAIL 静默吞成退出码 0。
    child.on('close', (code) => { clearTimeout(killTimer); resolve({ code, stdout, stderr, out: stdout + stderr }); });
    child.on('error', (e) => { clearTimeout(killTimer); resolve({ code: 1, stdout, stderr: stderr + `\n[SCRIPT_ERROR] ${e.message}`, out: stdout + stderr }); });
  });
}

async function main() {
  const log = [];
  const t0 = Date.now();
  const up = OFFLINE ? false : await wenmaiReachable();
  log.push(`[probe] 稳卖 3980: ${up ? '在线' : '离线（跳过抓取，仅建库+巡检）'}`);

  const fetchResults = [];
  if (up) {
    // 严格顺序：店铺漏斗 → 商品级流量（每店 openEnv 串行，避免 websocket 冲突）
    for (const st of storeArg) {
      const a = await runScript('scripts/fetch-store-overview.mjs', [st]);
      const ok = /"ok"\s*:\s*true/.test(a.out) || a.out.includes('ok:true');
      fetchResults.push({ store: st, kind: 'overview', code: a.code, ok });
      log.push(`[fetch] store-overview ${st}: ${a.code === 0 ? '完成' : 'exit ' + a.code}${ok ? ' (ok)' : ' (见 raw)'}`);

      const b = await runScript('scripts/fetch-sales-rank.mjs', [st]);
      const ok2 = /"ok"\s*:\s*true/.test(b.out);
      fetchResults.push({ store: st, kind: 'sales-rank', code: b.code, ok: ok2 });
      log.push(`[fetch] sales-rank ${st}: ${b.code === 0 ? '完成' : 'exit ' + b.code}${ok2 ? ' (ok)' : ' (见 raw)'}`);
    }
    if (FULL) {
      for (const st of storeArg) {
        const c = await runScript('scripts/fetch-ae-items.mjs', [st]);
        fetchResults.push({ store: st, kind: 'items', code: c.code, ok: c.code === 0 });
        log.push(`[fetch] ae-items ${st}: ${c.code === 0 ? '完成' : 'exit ' + c.code}`);
        const d = await runScript('scripts/fetch-ae-metrics.mjs', [st]);
        fetchResults.push({ store: st, kind: 'metrics', code: d.code, ok: d.code === 0 });
        log.push(`[fetch] ae-metrics ${st}: ${d.code === 0 ? '完成' : 'exit ' + d.code}`);
      }
    }
  }

  // 永远：建库 + 巡检
  const build = await runScript('scripts/build-ops-db.mjs', ['--rebuild']);
  log.push(`[build] ops.db: ${build.code === 0 ? '重建完成' : 'exit ' + build.code}`);
  const check = await runScript('scripts/ops-daily-check.mjs', ['--json']);
  let checkJson = null;
  try { checkJson = JSON.parse(check.stdout); } catch {
    log.push('[check] JSON 解析失败（stdout 非 JSON）：' + (check.stdout || '').slice(0, 200).replace(/\n/g, ' '));
  }

  // 补货总览：只读 ops.db，不碰浏览器 ⇒ 离线也产出（这是每天唯一"可直接执行"的业务产物）
  const restock = [];
  for (const st of storeArg) {
    const outFile = path.join(METRICS, `restock-${DATE.replace(/-/g, '')}-${st}.json`);
    const r = await runScript('agents/purchase-inventory/src/snapshot-from-opsdb.mjs',
      ['--store', st, '--batch', '--top', '10', '--out', outFile]);
    let j = null;
    try { j = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { /* 无产物 */ }
    if (j) {
      restock.push(j);
      const mix = Object.entries(j.dateMix || {}).map(([d, c]) => `${d}×${c}`).join(' ');
      log.push(`[restock] ${st}: RESTOCK ${j.summary?.restock ?? 0} SKU / ${j.totalSuggestQty ?? 0} 件（快照 ${mix || '-'}）`);
    } else {
      log.push(`[restock] ${st}: 无产物（exit ${r.code}）`);
    }
  }
  const restockTotalSku = restock.reduce((s, j) => s + (j.summary?.restock ?? 0), 0);
  const restockTotalQty = restock.reduce((s, j) => s + (j.totalSuggestQty ?? 0), 0);
  const restockMd = restock.length
    ? [
      `合计 **${restockTotalSku} SKU / ${restockTotalQty} 件**（逐 SKU 取最近观测；金额一律 0，COGS 未核准不下钱结论）`,
      ...restock.map((j) => {
        const top = (j.restockTop || []).slice(0, 3).map((x) => `${x.skuId}(补${x.suggestQty})`).join(' ');
        const mix = Object.entries(j.dateMix || {}).map(([d, c]) => `${d}×${c}`).join(' ');
        const rej = j.rejected?.count ? `　口径拒绝 ${j.rejected.count}` : '';
        return `- **${j.storeId}**: 需补 ${j.summary?.restock ?? 0} SKU / ${j.totalSuggestQty ?? 0} 件${top ? `　Top: ${top}` : ''}${mix ? `　快照 ${mix}` : ''}${rej}`;
      }),
    ].join('\n')
    : '- 无（ops.db 无 SKU 快照）';

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  const summary =
`# 运营日更 · ${DATE} · ${elapsed}s

> 编排器：scripts/daily-ops-pipeline.mjs ${FULL ? '--full ' : ''}（${up ? '浏览器在线' : '浏览器离线'}）

## 抓取结果
${fetchResults.length ? fetchResults.map((r) => `- ${r.store} ${r.kind}: ${r.code === 0 ? '✅' : '⚠️ exit ' + r.code}${r.ok ? ' ok' : ''}`).join('\n') : '- （浏览器离线，未抓取）'}

## 数据校验
${checkJson?.checks?.map((c) => `- ${c.status === 'PASS' ? '✅' : c.status === 'WARN' ? '⚠️ ' : '❌'} ${c.name}: ${c.detail}`).join('\n') ?? '- 无'}

## 业务告警（P0/P1/P2）
${checkJson?.alerts?.length ? checkJson.alerts.slice(0, 25).map((a) => `- [${a.level}] ${a.kind} ${a.store} ${a.subject}: ${a.detail}`).join('\n') : '- ✅ 无'}

## 补货总览（真实库存口径，可直接拿去核对下单）
${restockMd}

## 增收缺口
${checkJson?.gap?.map((g) => `- ${g.name}: 现状 ${g.qty_30d ?? '-'} 件/30d · ${g.month_target != null ? '目标 ' + g.month_target + ' / 缺 ' + g.gap_qty + ' (' + g.gap_pct + '%)' : '未设目标'}`).join('\n') ?? '-'}

---
\`\`\`
${log.join('\n')}
\`\`\`
`;

  const outPath = path.join(METRICS, `daily-summary-${DATE.replace(/-/g, '')}.md`);
  fs.mkdirSync(METRICS, { recursive: true });
  fs.writeFileSync(outPath, summary, 'utf8');
  console.log(summary);
  console.log(`\n摘要已写: ${path.relative(ROOT, outPath)}`);
  // fail-closed：巡检 JSON 拿不到（解析失败/脚本崩）也算失败，绝不静默返回 0
  const dataFailed = checkJson ? !!checkJson.dataFailed : true;
  if (!checkJson) console.error('⚠️ 巡检结果不可读，按数据校验失败处理（退出码 2）');
  process.exit(dataFailed ? 2 : 0);
}

main().catch((e) => { console.error('编排器失败:', e.message); process.exit(1); });
