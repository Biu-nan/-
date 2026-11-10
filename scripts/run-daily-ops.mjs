#!/usr/bin/env node
// scripts/run-daily-ops.mjs
// 计划任务的「入口壳」：Task Scheduler 直接调用它（不经过 cmd /c，规避 F:\软件 非 ASCII
// 路径在 .bat/.cmd 里的编码坑）。
//
// 它做三件事：切到仓库根 → 起 daily-ops-pipeline.mjs --full → 把 stdout/stderr 追加进
// data/metrics/pipeline-cron.log。退出码透传（0 正常 / 2 数据校验 FAIL）。
//
// 由 scripts/install-daily-task.mjs 注册进 Windows 计划任务；无需用户交互。

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const LOG = path.join(ROOT, "data", "metrics", "pipeline-cron.log");
fs.mkdirSync(path.dirname(LOG), { recursive: true });

const pipeline = path.join(ROOT, "scripts", "daily-ops-pipeline.mjs");
const startedAt = new Date().toISOString();
const header = `\n===== run-daily-ops @ ${startedAt} · node=${process.execPath} =====\n`;

const child = spawn(process.execPath, [pipeline, "--full"], {
  cwd: ROOT,
  env: { ...process.env, NODE_NO_WARNINGS: "1" },
});

let buf = "";
child.stdout.on("data", (d) => { buf += d; });
child.stderr.on("data", (d) => { buf += d; });

child.on("error", (e) => {
  fs.appendFileSync(LOG, `${header}[spawn error] ${e.message}\n`, "utf8");
  process.exit(1);
});

child.on("close", (code) => {
  const footer = `\n===== exit=${code ?? "null"} @ ${new Date().toISOString()} =====\n`;
  try {
    fs.appendFileSync(LOG, header + buf + footer, "utf8");
  } catch (e) {
    // 日志写不进去也不能让任务「假成功」：打到 stderr 由事件日志兜底
    console.error("append log failed:", e.message);
  }
  process.exit(code ?? 0);
});
