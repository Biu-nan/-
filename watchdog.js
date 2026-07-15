// 一跨而境工作台 - 看门狗（ESM 版本）
// 职责：
//   1. 开机/登录后自动拉起工作台服务 (node dist/src/server.js)
//   2. 周期性健康检查（HTTP GET /），若服务卡死（之前反复出现的"端口在、HTTP 不回"假死）
//      或进程退出，则自动杀掉并重启
//   3. 始终以 HOST=0.0.0.0 绑定，支持局域网多设备访问
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
const LOG_FILE = path.join(PROJECT_ROOT, "watchdog.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch (_) {
    /* ignore */
  }
}

// 健康检查：返回 true 表示服务正常（HTTP 200 且及时响应）
function isResponding() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: PORT, path: "/", timeout: HTTP_TIMEOUT },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
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

let child = null;
function startServer() {
  log("拉起工作台服务...");
  child = spawn(NODE, ["dist/src/server.js"], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, HOST, PORT: String(PORT) },
    stdio: "ignore",
  });
  child.on("exit", (code, signal) => {
    log(`工作台进程退出 code=${code} signal=${signal}`);
    child = null;
  });
  child.unref();
}

async function main() {
  log(`看门狗启动 (node=${NODE}, host=${HOST}, port=${PORT})`);
  while (true) {
    const ok = await isResponding();
    if (ok) {
      await new Promise((r) => setTimeout(r, CHECK_INTERVAL));
      continue;
    }
    log("服务无响应（卡死或已退出），准备重启...");
    killPort();
    await new Promise((r) => setTimeout(r, 2000));
    startServer();
    await new Promise((r) => setTimeout(r, STARTUP_WAIT));
  }
}

main();
