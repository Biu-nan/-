#!/usr/bin/env bash
# 单独重导出「自营仓库出入记录」35 天窗口（补齐 30 日 P95 所需历史流水）
#
# 背景（2026-10-12 采购门禁 G2 阻塞）：店小秘出入记录页面「时间」筛选默认只约 7 天，
#   直接导出的 latest 文件无法支撑 C6R 必需的 30 日 P95 窗口，采购侧 fail-closed 停止计算。
# 本脚本走修好后的窗口采集：切「时间=全部」→ 倒序早停 → 截断到最近 35 个完整自然日。
#
# 用法：bash scripts/reexport-entryexit.sh
# 产出：<dataRoot>/dxm-entryexit-latest.{json,csv,xlsx}
# 说明：必须「拉起 Chrome CDP → 等 ready → 导出」在同一次调用内完成（跨调用进程会被回收）。
set -u
cd "$(dirname "$0")/.." || exit 1

PROFILE="F:/yikuaborder-deploy/.chrome-profile"
CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe"
NODE="C:/Users/User/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG=".tmp/reexport-entryexit-${STAMP}.log"
mkdir -p .tmp

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

cdp_ready() {
  curl -s --noproxy '*' --max-time 5 http://127.0.0.1:9223/json/version >/dev/null 2>&1
}

# --- 1. CDP 前置 ---
if cdp_ready; then
  log "[1/2] CDP 9223 already ready"
else
  log "[1/2] launching Chrome with CDP 9223 ..."
  "$CHROME" --remote-debugging-port=9223 \
            --user-data-dir="$PROFILE" \
            --no-first-run --no-default-browser-check \
            --start-maximized >> "$LOG" 2>&1 &
  for i in $(seq 1 40); do
    if cdp_ready; then log "      CDP ready after ${i}s"; break; fi
    sleep 1
  done
  if ! cdp_ready; then
    log "      FATAL: CDP 9223 not ready after 40s"
    echo "CDP_FAIL" > .tmp/reexport-last-status.txt
    exit 3
  fi
fi

# --- 2. 窗口导出 ---
log "[2/2] running: node dxm-fetch.cjs --target entryExit"
"$NODE" dxm-fetch.cjs --target entryExit >> "$LOG" 2>&1
RC=$?
log "reexport exit=$RC"
echo "exit=$RC" > .tmp/reexport-last-status.txt
echo "LOG=$LOG"
exit $RC
