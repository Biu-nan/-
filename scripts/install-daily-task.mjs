#!/usr/bin/env node
// scripts/install-daily-task.mjs
// 注册 Windows 计划任务「YikuaDailyOps」：每天 17:30（日切后）跑 daily-ops-pipeline --full。
//
// 为什么用 Node 而不是 .bat：
//   node 路径 F:\软件\node.exe 含非 ASCII（软件）。写 .bat/.cmd 时该路径会被按 ANSI(GBK)
//   解释而乱码。这里用 spawn('schtasks', [...]) 直接传参（内存里是 UTF-16），零编码问题。
//
// 为什么用 /it 而不是 /rp：
//   /it = 「只在用户登录时运行」，用当前登录令牌，**不需要输入密码**（非交互可自动化）。
//   抓取依赖稳卖 :3980，运行在该登录会话里才有意义，正好匹配 /it。
//
// 用法（用生产 node 跑，让注册的也是生产 node）：
//   "F:\软件\node.exe" scripts\install-daily-task.mjs --dry-run   # 只打印将执行的命令
//   "F:\软件\node.exe" scripts\install-daily-task.mjs             # 创建/覆盖任务
//   "F:\软件\node.exe" scripts\install-daily-task.mjs --verify    # 查询任务详情
//   "F:\软件\node.exe" scripts/install-daily-task.mjs --remove    # 删除任务
//   可选：--time 17:30  --name YikuaDailyOps  --user <账号>（默认当前用户）

import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};

const NAME = opt("--name", "YikuaDailyOps");
const TIME = opt("--time", "17:30");
const USER = opt("--user", os.userInfo().username);
const DRY = argv.includes("--dry-run");
const VERIFY = argv.includes("--verify");
const REMOVE = argv.includes("--remove");

const NODE = process.execPath;
const ENTRY = path.join(ROOT, "scripts", "run-daily-ops.mjs");

// /tr 的取值：Task Scheduler 直接执行 exe + 一个带空格的脚本参数（无 cmd、无重定向、无嵌套引号）
const TR = `"${NODE}" "${ENTRY}"`;

function run(args, label) {
  if (DRY) {
    console.log(`[dry-run] schtasks ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
    return { status: 0 };
  }
  console.log(`> schtasks ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
  const r = spawnSync("schtasks", args, { stdio: "inherit", encoding: "utf8" });
  if (r.error) {
    console.error(`\n[${label}] 调用 schtasks 失败：${r.error.message}`);
    console.error("  · 若提示「拒绝访问/不是内部命令」，请在普通终端（非沙箱）用管理员或当前用户运行本脚本。");
    process.exit(3);
  }
  return r;
}

if (VERIFY) {
  run(["/query", "/tn", NAME, "/fo", "LIST", "/v"], "verify");
  process.exit(0);
}

if (REMOVE) {
  const r = run(["/delete", "/tn", NAME, "/f"], "remove");
  process.exit(r.status ?? 0);
}

// 默认：创建（/f 覆盖同名）
console.log(`\n任务名 : ${NAME}`);
console.log(`触发   : 每天 ${TIME}`);
console.log(`运行者 : ${USER}（/it：只在登录时运行，免密码）`);
console.log(`命令   : ${TR}`);
console.log(`工作根 : ${ROOT}\n`);

const createArgs = [
  "/create", "/tn", NAME, "/tr", TR,
  "/sc", "daily", "/st", TIME,
  "/ru", USER, "/it", "/f",
];
const r = run(createArgs, "create");
if (DRY) {
  console.log("\n[dry-run] 未实际创建。去掉 --dry-run 即执行。");
  process.exit(0);
}
if ((r.status ?? 1) === 0) {
  console.log(`\n✅ 已创建/覆盖计划任务「${NAME}」。`);
  console.log(`   查看：schtasks /query /tn "${NAME}" /fo LIST /v`);
  console.log(`   立即试跑：schtasks /run /tn "${NAME}"`);
  console.log(`   日志：${path.relative(ROOT, path.join(ROOT, "data", "metrics", "pipeline-cron.log"))}`);
  console.log(`   提醒：抓取需 17:30 时稳卖 :3980 在线，否则自动走离线（仅建库+巡检）。`);
} else {
  console.error(`\n创建失败（exit ${r.status}）。若因密码/权限：可在任务计划程序 GUI 新建，`);
  console.error(`安全选项选「只在用户登录时运行」——同样不需要密码。`);
  process.exit(1);
}
