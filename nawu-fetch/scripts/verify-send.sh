#!/usr/bin/env bash
# 只读核实：ChatGPT 对话里到底有没有那条用户消息？
# 关键：必须区分「已发送的用户消息」与「composer 里的草稿」——本次事故正是这两者被混淆。
# 不点击、不输入、不清空任何内容。
set -u
cd "$(dirname "$0")/.." || exit 1
PROFILE="F:/yikuaborder-deploy/.chrome-profile"
CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe"
OUT=".tmp/verify-send-$(date +%H%M%S).json"

curl -s --noproxy '*' --max-time 5 http://127.0.0.1:9223/json/version >/dev/null 2>&1 || {
  "$CHROME" --remote-debugging-port=9223 --user-data-dir="$PROFILE" \
            --no-first-run --no-default-browser-check \
            "https://chatgpt.com/" >/dev/null 2>&1 &
  for i in $(seq 1 30); do
    curl -s --noproxy '*' --max-time 3 http://127.0.0.1:9223/json/version >/dev/null 2>&1 && break
    sleep 1
  done
}

node probes/verify_true_send.cjs > "$OUT" 2>&1
echo "OUT=$OUT"
cat "$OUT"
