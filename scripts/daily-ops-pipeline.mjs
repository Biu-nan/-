#!/usr/bin/env node
// 运营日更编排器（一键串起：抓取 → 建库 → 巡检 → 摘要）
//
// 设计原则（继承稳卖客户端铁律）：
//   1. 稳卖 3980 的 openEnv 是**串行**的——多脚本并发会踩 websocket（"New request sent before
//      previous response received"）。故所有抓取**严格顺序**执行，绝不一把梭。
//   2. 抓取失败（如某店会话过期 NEEDS_MANUAL_LOGIN）只记录，不阻断后续与建库。
//   3. 建库 + 巡检**永远执行**（即使浏览器离线，也是对现有数据的最新分析）。
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
  return i > -1 ? argv[i + 1] : new Date().toISOString().slice(0, 10);
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
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      out += `\n[SCRIPT_TIMEOUT] ${scriptRel} 超过 ${SCRIPT_TIMEOUT_MS / 1000}s 被强制终止（疑似 openEnv/页面卡死）\n`;
      resolve({ code: 124, out, timedOut: true });
    }, SCRIPT_TIMEOUT_MS);
    child.on('close', (code) => { clearTimeout(killTimer); resolve({ code, out }); });
    child.on('error', (e) => { clearTimeout(killTimer); resolve({ code: 1, out: out + `\n[SCRIPT_ERROR] ${e.message}` }); });
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
  try { checkJson = JSON.parse(check.stdout || check.out); } catch { /* */ }

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
  process.exit(checkJson?.dataFailed ? 2 : 0);
}

main().catch((e) => { console.error('编排器失败:', e.message); process.exit(1); });
