#!/bin/bash
INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // .command // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0
[ "${CODEX_ALLOW_DEPENDENCY_ADD:-0}" = "1" ] && exit 0
if printf '%s\n' "$CMD" | grep -Eq '(^|[;&|][[:space:]]*|[[:space:]])(pnpm|yarn|bun)[[:space:]]+add([[:space:]]|$)|(^|[;&|][[:space:]]*|[[:space:]])npm[[:space:]]+(install|i)[[:space:]]+(-[A-Za-z-]+[[:space:]]+)*[^-[:space:]][^[:space:]]*'; then
  echo "已阻止新增依赖。说明必要性和替代方案并获得同意后，设置 CODEX_ALLOW_DEPENDENCY_ADD=1。" >&2
  exit 2
fi
exit 0

