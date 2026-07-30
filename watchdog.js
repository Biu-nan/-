// 一跨而境工作台 - 看门狗（ESM 版本）
// 职责：
//   1. 开机/登录后自动拉起工作台服务 (node dist/src/server.js)
//   2. 周期性健康检查（HTTP GET /api/status），若服务卡死（之前反复出现的"端口在、HTTP 不回"假死）
//      或进程退出，则自动杀掉并重启
//   3. 关键改进（防"误杀正在跑任务的 server"导致流程中断）：
//      - 健康检查查 /api/status（轻量 JSON），并识别 state.running（正在跑任务）
//      - 连续 N 次无响应才判定卡死并重启（避免单次抖动误杀）
//      - 杀之前若服务正在跑任务（running:true），放弃本次重启，避免误杀长任务
//      - 把 server 的 stdout/stderr 重定向到 server.out.log，便于诊断真崩原因
//   4. 始终以 HOST=0.0.0.0 绑定，支持局域网多设备访问
//
// 用法：node watchdog.js  （由 start-workbench.vbs 在登录时静默拉起）
// 注意：本项目为 ESM（package.json type=module），此处必须用 import 语法。

import { spawn, execSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath; // 当前 node 运行时（托管版）
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const CHECK_INTERVAL = 15000; // 两次健康检查间隔
const HTTP_TIMEOUT = 5000; // 单次 HTTP 超时（健康服务 <100ms 即响应）
const STARTUP_WAIT = 20000; // 重启后给服务端初始化留的时间
const FAIL_THRESHOLD = 2; // 连续 N 次无响应才判定卡死并重启（避免单次抖动误杀）
const LOG_FILE = path.join(PROJECT_ROOT, "watchdog.log");
const SERVER_LOG = path.join(PROJECT_ROOT, "server.out.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch (_) {
    /* ignore */
  }
}

// 健康检查：返回 { ok, running }
// ok=true 表示 /api/status 正常响应（HTTP 200）
// running=true 表示服务正在执行任务（此时不应被强杀）
function probeStatus() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: PORT, path: "/api/status", timeout: HTTP_TIMEOUT },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let running = false;
          try {
            const j = JSON.parse(data);
            running = !!(j && j.state && j.state.running);
          } catch (_) {
            /* ignore */
          }
          resolve({ ok: res.statusCode === 200, running });
        });
      }
    );
    req.on("error", () => resolve({ ok: false, running: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, running: false });
    });
  });
}

// 找到占用 PORT 的进程 PID（用于清除卡死进程）
function getPidOnPort() {
  try {
    const out = execSync(`netstat -ano -p TCP | findstr ":${PORT}"`, {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    for (const line of out.split("\n")) {
      if (line.includes("LISTENING")) {
        const parts = line.trim().split(/\s+/);
        return parseInt(parts[parts.length - 1], 10);
      }
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

function killPort() {
  const pid = getPidOnPort();
  if (pid) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      log(`已终止占用 ${PORT} 的卡死进程 PID=${pid}`);
    } catch (e) {
      log(`taskkill PID=${pid} 失败: ${e.message}`);
    }
  }
}

let serverLog = null;
function startServer() {
  log("拉起工作台服务...");
  if (serverLog) {
    try {
      serverLog.end();
    } catch (_) {
      /* ignore */
    }
  }
  // 把 server 的 stdout/stderr 重定向到文件，便于诊断真崩原因（替代原 stdio:"ignore"）
  serverLog = fs.createWriteStream(SERVER_LOG, { flags: "a" });
  child = spawn(NODE, ["dist/src/server.js"], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, HOST, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(serverLog, { end: false });
  child.stderr.pipe(serverLog, { end: false });
  child.on("exit", (code, signal) => {
    log(`工作台进程退出 code=${code} signal=${signal}`);
    child = null;
  });
  child.unref();
}

let child = null;
let consecutiveFail = 0;
async function main() {
  log(`看门狗启动 (node=${NODE}, host=${HOST}, port=${PORT})`);
  while (true) {
    const probe = await probeStatus();
    if (probe.ok) {
      consecutiveFail = 0;
      // 服务活着：无论是否在跑任务，都不打扰，仅定期探活
      await new Promise((r) => setTimeout(r, CHECK_INTERVAL));
      continue;
    }
    // 无响应：累计失败次数，未达门限先观察（容忍单次抖动）
    consecutiveFail++;
    log(`健康检查无响应（第 ${consecutiveFail}/${FAIL_THRESHOLD} 次）`);
    if (consecutiveFail < FAIL_THRESHOLD) {
      await new Promise((r) => setTimeout(r, CHECK_INTERVAL));
      continue;
    }
    // 达门限：杀之前再探一次，若此时复活且正在跑任务则放弃重启（防误杀长任务）
    const retry = await probeStatus();
    if (retry.ok && retry.running) {
      log("服务恢复且正在运行任务，放弃本次重启");
      consecutiveFail = 0;
      await new Promise((r) => setTimeout(r, CHECK_INTERVAL));
      continue;
    }
    log("服务无响应（卡死或已退出），准备重启...");
    killPort();
    await new Promise((r) => setTimeout(r, 2000));
    startServer();
    consecutiveFail = 0;
    await new Promise((r) => setTimeout(r, STARTUP_WAIT));
  }
}

main();
