// 一跨而境工作台 - 看门狗（ESM 版本）
// 职责：
//   1. 开机/登录后自动拉起工作台服务 (node dist/src/server.js)
//   2. 周期性健康检查（优先 HTTP GET /healthz，该端点不存在时回退 GET /api/status），
//      若服务卡死（之前反复出现的"端口在、HTTP 不回"假死）或进程退出，则自动杀掉并重启
//   3. 关键改进（防"误杀正在跑任务的 server"导致流程中断）：
//      - 健康检查识别"正在跑任务"：/healthz 读 inFlight，/api/status 读 state.running
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

// 单次 HTTP GET，返回 { reachable, statusCode, body }。
// reachable=false 是"连不上或超时"的唯一判据——只有它才代表进程可能真死了。
function httpGetOnce(pathname) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const req = http.get(
      { host: "127.0.0.1", port: PORT, path: pathname, timeout: HTTP_TIMEOUT },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => done({ reachable: true, statusCode: res.statusCode, body: data }));
        res.on("error", () => done({ reachable: false, statusCode: 0, body: "" }));
      }
    );
    req.on("error", () => done({ reachable: false, statusCode: 0, body: "" }));
    req.on("timeout", () => {
      req.destroy();
      done({ reachable: false, statusCode: 0, body: "" });
    });
  });
}

// 健康检查：返回 { ok, running, via }
//
// A2d-0 —— 为什么必须两步，而不是直接改探 /healthz：
//   · 生产一旦装上 CEO 网关，/api/status 会被 classifyCeoRequest 判成 unsafe
//     （公开白名单只有 /healthz 与 /api/version）。看门狗继续探 /api/status，
//     就会把活着的服务判死 → taskkill → 无限重启（阻塞 B 的机制）。
//   · 但也不能直接改成探 /healthz：现役单根部署压根没有这个端点
//     （它只在 CEO_RUNTIME_MODE 非空时挂载），直接改会把今天的 :3000 立刻打成重启循环。
//   · 所以保留回退，并保证：现役（/healthz 返回 404）走的路径与改造前完全一致。
//
// running 的语义不变——"正在跑任务就不要强杀"。两个端点各有一套字段：
// /healthz 的响应带 inFlight，/api/status 的响应带 state.running，谁在就认谁。
async function probeStatus() {
  const hz = await httpGetOnce("/healthz");

  // 端点存在且就绪：这在网关下也走得通（/healthz 属 public.read）
  if (hz.reachable && hz.statusCode === 200) {
    let running = false;
    try {
      running = JSON.parse(hz.body)?.inFlight === true;
    } catch (_) {
      /* 响应体不是 JSON 不影响存活判断 */
    }
    return { ok: true, running, via: "healthz" };
  }

  // 端点存在但不是 200（例如 503 未就绪）：与 /api/status 的 503 同义，判不 ok。
  // 刻意不回退——回退只会把"未就绪"掩盖成"另一个端点也不 ok"，丢掉真正的原因。
  if (hz.reachable && hz.statusCode !== 404) {
    return { ok: false, running: false, via: "healthz" };
  }

  // 连不上，或 404（这份部署没挂 /healthz）→ 回退到原路径，行为与改造前一致
  const st = await httpGetOnce("/api/status");
  let running = false;
  try {
    const j = JSON.parse(st.body);
    running = !!(j && j.state && j.state.running);
  } catch (_) {
    /* ignore */
  }
  return { ok: st.reachable && st.statusCode === 200, running, via: "api-status" };
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

  // 登录自启动时通常没有现成服务。此前会先经历两轮健康检查，
  // 导致用户要等待约半分钟网站才开始监听。端口空闲时可安全立即拉起。
  const initialProbe = await probeStatus();
  // 记一行实际走的端点：/healthz（CEO 生产形态）还是 /api/status（现役单根）。
  // 这是排查"装上网关后为什么不再重启""为什么突然开始重启"的第一手线索。
  log(`初始探针：via=${initialProbe.via} ok=${initialProbe.ok} running=${initialProbe.running}`);
  if (!initialProbe.ok && !getPidOnPort()) {
    log("启动时未发现工作台服务，立即拉起...");
    startServer();
    await new Promise((r) => setTimeout(r, 3000));
  }

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
