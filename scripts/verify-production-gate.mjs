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
// 三种用法：
//   1) 实跑（应用方案 C 之后，对真实实例）：
//        node scripts/verify-production-gate.mjs --port 3000
//   2) 自测断言器（进程内 http mock，验证断言逻辑）：
//        node scripts/verify-production-gate.mjs --self-test
//   3) 自测「那段真实代码」（进程内真实 express 挂载方案 C 片段，生产/非生产双跑）：
//        node scripts/verify-production-gate.mjs --self-test-snippet
//
// 注意：用 node:http 直连（不走系统代理），避免 curl 被 HTTP(S)_PROXY 转走返回假 502。

import http from "node:http";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const HOST = opt("--host", "127.0.0.1");
const PORT = Number(opt("--port", "3000"));
const MODE = opt("--mode", "PRODUCTION"); // "" 表示期望非生产
const API_PROBE = opt("--api-probe", "/api/status");
const API_EXPECT = Number(opt("--expect-api", MODE ? "404" : "200"));
const SELF_TEST = argv.includes("--self-test");
const SELF_TEST_SNIPPET = argv.includes("--self-test-snippet");

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

async function runChecks(port, host, expectMode, apiProbe, apiExpect) {
  const results = [];
  const push = (name, pass, detail) => results.push({ name, pass, detail });

  const h = await get(port, "/healthz", host);
  push("/healthz = 200", h.status === 200, `status=${h.status}${h.error ? " " + h.error : ""}`);

  const v = await get(port, "/api/version", host);
  const modeOk = v.status === 200 && (expectMode === "" ? v.json?.mode !== "PRODUCTION" : v.json?.mode === expectMode);
  push(`/api/version = 200 且 mode=${expectMode || "非PRODUCTION"}`, modeOk, `status=${v.status} mode=${v.json?.mode ?? "?"}`);

  const a = await get(port, apiProbe, host);
  push(`${apiProbe} = ${apiExpect}`, a.status === apiExpect, `status=${a.status}${a.error ? " " + a.error : ""}`);

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

// ── 方案 C 的「那段真实代码」：与实施清单 §2 逐字一致（用 enabled 代替 CEO_PRODUCTION_MODE）──
function mountProdGate(app, enabled) {
  if (enabled) {
    const PROD_PUBLIC_API = new Set(["/api/version"]);
    app.use((req, res, next) => {
      if (req.path === "/healthz") return next();
      if (req.path.startsWith("/api/") && !PROD_PUBLIC_API.has(req.path)) {
        return res.status(404).json({ error: "NOT_FOUND", mode: "PRODUCTION" });
      }
      next();
    });
  }
}

function buildApp(express, enabled) {
  const app = express();
  mountProdGate(app, enabled);
  app.get("/healthz", (_req, res) => res.status(200).send("ok"));
  app.get("/api/version", (_req, res) => res.status(200).json({ mode: "PRODUCTION", version: "test" }));
  app.get("/api/status", (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

async function withServer(app, fn) {
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const port = srv.address().port;
  try { return await fn(port); } finally { await new Promise((r) => srv.close(r)); }
}

async function selfTest() {
  // 进程内 http mock：验证断言逻辑本身。
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
    const results = await runChecks(port, "127.0.0.1", "PRODUCTION", "/api/status", 404);
    const fail = report(results, `自测断言器（进程内 http mock，port=${port}）`);
    console.log(fail === 0 ? "\nSELF-TEST PASS：断言逻辑正确。" : "\nSELF-TEST FAIL：断言器本身有问题。");
    process.exit(fail === 0 ? 0 : 1);
  } finally {
    await new Promise((r) => mock.close(r));
  }
}

async function selfTestSnippet() {
  const { default: express } = await import("express");
  let fail = 0;

  // 生产：应 200/200/404
  fail += await withServer(buildApp(express, true), async (port) => {
    const r = await runChecks(port, "127.0.0.1", "PRODUCTION", "/api/status", 404);
    return report(r, `片段自测 · PRODUCTION（express，port=${port}）`);
  });

  // 非生产：应 /api/status=200（现役行为不变）
  fail += await withServer(buildApp(express, false), async (port) => {
    const r = await runChecks(port, "127.0.0.1", "PRODUCTION", "/api/status", 200);
    return report(r, `片段自测 · 非生产（express，port=${port}）`);
  });

  console.log(fail === 0 ? "\nSNIPPET-TEST PASS：方案 C 片段在真实 express 下行为正确（生产 404 / 非生产 200）。" : "\nSNIPPET-TEST FAIL：片段行为不符，勿 apply。");
  process.exit(fail === 0 ? 0 : 1);
}

const main = async () => {
  if (SELF_TEST) return selfTest();
  if (SELF_TEST_SNIPPET) return selfTestSnippet();
  const results = await runChecks(PORT, HOST, MODE, API_PROBE, API_EXPECT);
  const fail = report(results, `生产门验证 @ ${HOST}:${PORT}`);
  console.log(fail === 0 ? "\n✅ 方案 C 契约满足。" : "\n❌ 未满足契约（若实例尚未应用方案 C，这是预期的；见 docs/A2D2_C_MINIMAL_IMPL_2026-11-10.md）。");
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
