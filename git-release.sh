#!/usr/bin/env bash
# 一跨而境 · 发布脚本
# 约定（用户要求）：每一次更新 = 提交(带版本号) + 打标签 + 推送
#
# 用法:
#   ./git-release.sh 1.2.1 "修复上架模板选择器闪烁"
#   ./git-release.sh            # 交互式输入版本号与说明
#
# 版本号规则（语义化）:
#   - 补丁 v1.2.x ：修 bug / 小调整
#   - 次版本 v1.x.0 ：新增功能
#   - 主版本 vx.0.0 ：不兼容的重大重构
set -euo pipefail
cd "$(dirname "$0")"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ 当前目录不是 git 仓库" >&2; exit 1
fi
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "❌ 未配置 remote 'origin'，请先执行:" >&2
  echo "   git remote add origin <你的GitHub仓库URL>" >&2
  exit 1
fi

VERSION="${1:-}"
MSG="${2:-}"
if [ -z "$VERSION" ]; then read -rp "版本号 (例 1.2.1): " VERSION; fi
if [ -z "$MSG" ]; then read -rp "本次更新说明: " MSG; fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# 没有改动则跳过提交，但仍确保标签/推送
if git diff --quiet && git diff --cached --quiet; then
  echo "ℹ️  没有待提交的改动，仅确保标签/推送"
else
  git add -A
  git commit -m "release: v$VERSION — $MSG"
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "⚠️  标签 v$VERSION 已存在，跳过打标"
else
  git tag "v$VERSION"
fi

git push origin "$BRANCH" --tags
echo "✅ 已发布 v$VERSION 并推送到 origin/$BRANCH"
