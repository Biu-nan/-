#!/usr/bin/env node
// scripts/verify-production-gate.mjs
// A2d 方案 C（最小版）行为验证器：断言「生产模式下」的 /api 门契约。
//
// 方案 C 契约（见 docs/A2D2_C_MINIMAL_IMPL_2026-11-10.md）：
//   · GET /healthz        → 200           （看门狗探这个判活）
//   · GET /api/version    → 200 且 body.mode === "PRODUCTION"
//   · GET /api/status     → 404           （其余 /api/* 生产下默认 404，不装网关）
//   · 非生产实例：/api/status 仍 200（现役行为不变）——用 --mode "" 期望
//
// 两种用法：
//   1) 实跑（应用方案 C 之后，对真实实例）：
//        node scripts/verify-production-gate.mjs --port 3000
//   2) 自测（不碰任何真实实例：进程内起一个 mock 服务，验证断言逻辑本身对）：
//        node scripts/verify-production-gate.mjs --self-test
//
// 注意：用 node:http 直连（不走系统代理），避免 curl 被 HTTP(S)_PROXY 转走返回假 502。

import http from "node:http";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const HOST = opt("--host", "127.0.0.1");
const PORT = Number(opt("--port", "3000"));
const EXPECT_MODE = opt("--mode", "PRODUCTION"); // "" 表示期望非生产
const API_PROBE = opt("--api-probe", "/api/status");
const EXPECT_API = Number(opt("--expect-api", EXPECT_MODE ? "404" : "200"));
const SELF_TEST = argv.includes("--self-test");

function get(port, pathname, host = HOST) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: pathname, timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(body); } catch { /* not json */ }
        resolve({ status: res.statusCode, json, body });
      });
    });
    req.on("error", (e) => resolve({ status: 0, error: e.code || e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, error: "TIMEOUT" }); });
  });
}

async function runChecks(port, host) {
  const results = [];
  const push = (name, pass, detail) => results.push({ name, pass, detail });

  const h = await get(port, "/healthz", host);
  push("/healthz = 200", h.status === 200, `status=${h.status}${h.error ? " " + h.error : ""}`);

  const v = await get(port, "/api/version", host);
  const modeOk = v.status === 200 && (EXPECT_MODE === "" ? v.json?.mode !== "PRODUCTION" : v.json?.mode === EXPECT_MODE);
  push(`/api/version = 200 且 mode=${EXPECT_MODE || "非PRODUCTION"}`, modeOk, `status=${v.status} mode=${v.json?.mode ?? "?"}`);

  const a = await get(port, API_PROBE, host);
  push(`${API_PROBE} = ${EXPECT_API}`, a.status === EXPECT_API, `status=${a.status}${a.error ? " " + a.error : ""}`);

  return results;
}

function report(results, title) {
  console.log(`\n# ${title}`);
  let fail = 0;
  for (const r of results) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}  (${r.detail})`);
    if (!r.pass) fail++;
  }
  console.log(`\n# ${results.length} 项，通过 ${results.length - fail}，失败 ${fail}`);
  return fail;
}

async function selfTest() {
  // 进程内 mock：实现方案 C 契约。不 detached、不占真实端口，测完即关。
  const mock = http.createServer((req, res) => {
    const p = req.url.split("?")[0];
    if (p === "/healthz") { res.writeHead(200); return res.end("ok"); }
    if (p === "/api/version") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ mode: "PRODUCTION", version: "test" })); }
    if (p.startsWith("/api/")) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "NOT_FOUND" })); }
    res.writeHead(200); res.end("ui");
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const port = mock.address().port;
  try {
    const results = await runChecks(port, "127.0.0.1");
    const fail = report(results, `自测（进程内 mock，port=${port}）`);
    console.log(fail === 0 ? "\nSELF-TEST PASS：验证器逻辑正确，可对真实实例使用。" : "\nSELF-TEST FAIL：验证器本身有问题，先修再跑真实实例。");
    process.exit(fail === 0 ? 0 : 1);
  } finally {
    await new Promise((r) => mock.close(r));
  }
}

const main = async () => {
  if (SELF_TEST) return selfTest();
  const results = await runChecks(PORT, HOST);
  const fail = report(results, `生产门验证 @ ${HOST}:${PORT}`);
  console.log(fail === 0 ? "\n✅ 方案 C 契约满足。" : "\n❌ 未满足契约（若实例尚未应用方案 C，这是预期的；见 docs/A2D2_C_MINIMAL_IMPL_2026-11-10.md）。");
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
