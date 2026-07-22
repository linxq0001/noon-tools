#!/bin/bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
STATE_FILE="$ROOT/.codex/verification/state"
[ ! -f "$STATE_FILE" ] && exit 0
STATE=$(tr -d '[:space:]' < "$STATE_FILE")
case "$STATE" in
  clean|waived|"") rm -f "$STATE_FILE"; exit 0 ;;
  *) echo '{"decision":"block","reason":"全栈代码、Schema、迁移或部署配置已修改但验证尚未完成。请运行 testing-fullstack-changes；完成后写入 clean，无法执行时记录原因和风险后写入 waived。"}'; exit 0 ;;
esac

