#!/usr/bin/env bash
# 采购管线编排器（单次调用内自持 Chrome CDP）
# 原因：本机 WorkBuddy 工具调用结束会回收其进程树，跨调用保不住 9223 监听。
# 方案：把「拉起 Chrome → 等 CDP ready → 跑管线」放进同一次调用内完成。
#
# 用法：
#   bash scripts/run-pipeline.sh                 # 全流程（采集+发送）
#   bash scripts/run-pipeline.sh --no-fetch      # 跳过采集，用现有文件发送
#   bash scripts/run-pipeline.sh --no-fetch --force   # 跳过采集且跳过新鲜度门禁
#
# 日志与取证：结果一律写 .tmp/pipeline-*.log（stdout 常被吞）

set -u
cd "$(dirname "$0")/.." || exit 1

PROFILE="F:/yikuaborder-deploy/.chrome-profile"
CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG=".tmp/pipeline-${STAMP}.log"
mkdir -p .tmp

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

cdp_ready() {
  curl -s --noproxy '*' --max-time 5 http://127.0.0.1:9223/json/version >/dev/null 2>&1
}

# --- 1. CDP 前置 ---
if cdp_ready; then
  log "[1/3] CDP 9223 already ready"
else
  log "[1/3] launching Chrome with CDP 9223 ..."
  "$CHROME" --remote-debugging-port=9223 \
            --user-data-dir="$PROFILE" \
            --no-first-run --no-default-browser-check \
            --start-maximized "https://chatgpt.com/" >> "$LOG" 2>&1 &
  CHROME_PID=$!
  for i in $(seq 1 40); do
    if cdp_ready; then log "      CDP ready after ${i}s (pid=$CHROME_PID)"; break; fi
    sleep 1
  done
  if ! cdp_ready; then
    log "      FATAL: CDP 9223 not ready after 40s"
    echo "CDP_FAIL" > .tmp/pipeline-last-status.txt
    exit 3
  fi
fi

# --- 2. 稳卖前置（纳物侧依赖 3980） ---
if curl -s --noproxy '*' --max-time 5 http://127.0.0.1:3980/ >/dev/null 2>&1; then
  log "[2/3] 稳卖 API 3980 reachable"
else
  log "[2/3] WARN 稳卖 API 3980 NOT reachable → 纳物两店采集会失败"
fi

# --- 3. 跑管线 ---
NODE="C:/Users/User/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
log "[3/3] running: node awu-send-to-chatgpt.cjs $*"
"$NODE" awu-send-to-chatgpt.cjs "$@" >> "$LOG" 2>&1
RC=$?
log "pipeline exit=$RC"
echo "exit=$RC" > .tmp/pipeline-last-status.txt

# Chrome 保持运行（供下一次调用复用），失败则不保留
# 注意：CDP 由外部就绪时 CHROME_PID 未定义（set -u 会炸），须给默认空值
if [ "$RC" -ne 0 ]; then
  kill "${CHROME_PID:-}" 2>/dev/null
fi

echo "LOG=$LOG"
exit $RC
