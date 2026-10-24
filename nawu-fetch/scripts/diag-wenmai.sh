#!/usr/bin/env bash
# 稳卖（WenMaiAIBrowser）启动诊断 + 重试
# 已知故障：启动即 FATAL breeze_conf.cc(545) zonghu config JSON 解析失败
# 本脚本只做「观察式」诊断：不修改任何稳卖配置（登录态高敏）
set -u
EXE="C:/Users/User/AppData/Roaming/WenMaiAIBrowser/Browser/135/WenMaiAIBrowser.exe"
LOG=".tmp/wenmai-diag-$(date +%Y%m%d-%H%M%S).log"
mkdir -p .tmp

echo "== exe exists: $([ -f "$EXE" ] && echo yes || echo no)" | tee -a "$LOG"
echo "== attempt 1 (foreground 12s) ==" | tee -a "$LOG"
timeout 12 "$EXE" >> "$LOG" 2>&1
echo "attempt1 rc=$?" | tee -a "$LOG"

for i in 1 2 3; do
  sleep 3
  if curl -s --noproxy '*' --max-time 4 http://127.0.0.1:3980/ >/dev/null 2>&1; then
    echo "== 3980 REACHABLE after retry $i ==" | tee -a "$LOG"
    echo "WENMAI_UP" > .tmp/wenmai-status.txt
    exit 0
  fi
  echo "== retry $i: 3980 still down ==" | tee -a "$LOG"
done

echo "== attempt 2 (background, wait 15s) ==" | tee -a "$LOG"
"$EXE" >> "$LOG" 2>&1 &
WPID=$!
for i in $(seq 1 15); do
  sleep 1
  if curl -s --noproxy '*' --max-time 3 http://127.0.0.1:3980/ >/dev/null 2>&1; then
    echo "== 3980 REACHABLE at ${i}s (pid=$WPID) ==" | tee -a "$LOG"
    echo "WENMAI_UP" > .tmp/wenmai-status.txt
    exit 0
  fi
done

echo "WENMAI_DOWN" > .tmp/wenmai-status.txt
echo "== FINAL: 3980 unreachable ==" | tee -a "$LOG"
echo "LOG=$LOG"
exit 1
