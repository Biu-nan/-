// 验证 watchdog.js 的健康探针逻辑，**不执行 main()**（不拉起、不杀任何服务）。
//
// 做法：从 watchdog.js 源文件里把 httpGetOnce 与 probeStatus 两段原文抽出来，
// 拼成 data: URL 模块导入 —— 测的就是源文件里的代码，不是抄一份副本。
// 这样既不用给看门狗加"可被导入"的开关（那会改动保命组件的执行路径），
// 也不会因为复制一份逻辑而出现"测试通过但真实代码没改"的假绿。
//
// 用法：node scripts/verify-watchdog-probe.mjs
// 可选：WATCHDOG_PROBE_LIVE_PORT=3000 node scripts/verify-watchdog-probe.mjs
//       （额外对现役端口真探一次；未设置则跳过，脚本在任何环境都能跑）
//
// 背景见 docs/A2_PREREQ_BINDING_2026-11-10.md §17。

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'watchdog.js');
const src = fs.readFileSync(SRC, 'utf8');

const start = src.indexOf('function httpGetOnce');
const end = src.indexOf('// 找到占用 PORT');
if (start < 0 || end < 0) throw new Error('抽取失败：找不到函数边界');

const body = src.slice(start, end);
if (!body.includes('function probeStatus')) throw new Error('抽取失败：probeStatus 不在片段内');
const topLevel = body.split('\n').filter((l) => /^(const|let|var|await|import)\s/.test(l));
if (topLevel.length) throw new Error('片段内出现顶层语句，抽取不安全:\n' + topLevel.join('\n'));

// data: URL 里不能解析裸的 node: 说明符以外的路径，函数体只用 http / PORT / HTTP_TIMEOUT，
// 这三个由下面的前导声明提供。
const lib =
  'import http from "node:http";\n' +
  'const HTTP_TIMEOUT = 2000;\n' +
  'let PORT = 0;\n' +
  'export function setPort(p) { PORT = p; }\n' +
  body +
  '\nexport { probeStatus };\n';

const mod = await import('data:text/javascript;base64,' + Buffer.from(lib, 'utf8').toString('base64'));

/** 起一个假服务，routes 形如 { '/healthz': [code, bodyText] } */
function fakeServer(routes) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const r = routes[req.url];
      if (!r) { res.writeHead(404); res.end('{}'); return; }
      res.writeHead(r[0], { 'Content-Type': 'application/json' });
      res.end(r[1]);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

let pass = 0, fail = 0, skipped = 0;
function check(name, got, want) {
  const bad = Object.keys(want).filter((k) => got[k] !== want[k]);
  if (bad.length) {
    fail++;
    console.log(`✖ ${name}`);
    for (const k of bad) console.log(`    ${k}: 期望 ${want[k]}  实际 ${got[k]}`);
  } else {
    pass++;
    console.log(`✔ ${name}   → ${JSON.stringify(got)}`);
  }
}

// ① /healthz 200 + inFlight:true（CEO 生产形态，且正在跑任务）
{
  const { srv, port } = await fakeServer({
    '/healthz': [200, '{"ready":true,"inFlight":true}'],
    '/api/status': [200, '{"state":{"running":false}}'],
  });
  mod.setPort(port);
  check('① /healthz 200 + inFlight:true', await mod.probeStatus(),
    { ok: true, running: true, via: 'healthz' });
  srv.close();
}

// ② /healthz 404（现役单根部署）→ 必须回退，且行为与改造前一致
{
  const { srv, port } = await fakeServer({
    '/api/status': [200, '{"state":{"running":true}}'],
  });
  mod.setPort(port);
  check('② /healthz 404 → 回退 /api/status（等价现役）', await mod.probeStatus(),
    { ok: true, running: true, via: 'api-status' });
  srv.close();
}

// ③ /healthz 503（端点存在但未就绪）→ 判不 ok，且不回退
{
  const { srv, port } = await fakeServer({
    '/healthz': [503, '{"ready":false,"reasons":["BINDING_APPROVAL_MISSING"]}'],
    '/api/status': [200, '{"state":{"running":false}}'],
  });
  mod.setPort(port);
  check('③ /healthz 503 → 不 ok 且不回退', await mod.probeStatus(),
    { ok: false, via: 'healthz' });
  srv.close();
}

// ④ 响应体不是 JSON：不能因此判死
{
  const { srv, port } = await fakeServer({
    '/healthz': [200, 'not-json'],
    '/api/status': [200, '{"state":{"running":true}}'],
  });
  mod.setPort(port);
  check('④ /healthz 200 但体非 JSON → 仍判活', await mod.probeStatus(),
    { ok: true, running: false, via: 'healthz' });
  srv.close();
}

// ⑤ 端口无人监听 → 两跳都连不上，判不 ok
{
  mod.setPort(1);
  check('⑤ 端口无人监听 → 不 ok', await mod.probeStatus(),
    { ok: false, running: false, via: 'api-status' });
}

// ⑥ 可选：对现役端口真探一次。现役没有 /healthz（404），
//    期望回退到 /api/status 并判活 —— 这是"行为零变化"的直接证据。
const livePort = Number(process.env.WATCHDOG_PROBE_LIVE_PORT ?? 0);
if (livePort > 0) {
  mod.setPort(livePort);
  check(`⑥ 现役 :${livePort} 真探（应回退且判活）`, await mod.probeStatus(),
    { ok: true, via: 'api-status' });
} else {
  skipped++;
  console.log('○ ⑥ 现役真探：未设置 WATCHDOG_PROBE_LIVE_PORT，跳过');
}

console.log(`\n结果：pass=${pass} fail=${fail} skipped=${skipped}`);
process.exit(fail === 0 ? 0 : 1);
