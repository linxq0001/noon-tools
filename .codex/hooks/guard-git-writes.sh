#!/bin/bash
INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // .command // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0
[ "${CODEX_ALLOW_GIT_WRITE:-0}" = "1" ] && exit 0
if printf '%s\n' "$CMD" | grep -Eq '(^|[;&|][[:space:]]*|[[:space:]])git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?(commit|push|merge|rebase)([[:space:]]|$)'; then
  echo "已阻止 Git 写操作。仅在用户明确要求本次操作时设置 CODEX_ALLOW_GIT_WRITE=1。" >&2
  exit 2
fi
exit 0

