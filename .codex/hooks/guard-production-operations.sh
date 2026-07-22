#!/bin/bash
INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // .command // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0
[ "${CODEX_ALLOW_PRODUCTION_OPERATION:-0}" = "1" ] && exit 0

if printf '%s\n' "$CMD" | grep -Eqi '(prisma[[:space:]]+migrate[[:space:]]+deploy|prisma[[:space:]]+db[[:space:]]+push|terraform[[:space:]]+(apply|destroy)|vercel[[:space:]]+--prod|wrangler[[:space:]]+deploy|kubectl[[:space:]]+(apply|delete|replace|patch|scale)|aws[[:space:]].*(create|delete|put-|update|deploy)|gcloud[[:space:]].*(deploy|create|delete|update))'; then
  echo "已阻止疑似生产写操作。请说明具体命令、目标环境与资源、影响、备份和回滚，并在获得本次确认后设置 CODEX_ALLOW_PRODUCTION_OPERATION=1。" >&2
  exit 2
fi
exit 0
