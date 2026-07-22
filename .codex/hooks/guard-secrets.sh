#!/bin/bash
INPUT=$(cat)
TEXT=$(printf '%s' "$INPUT" | jq -r '[.tool_input.command, .command, .tool_input.content, .content, .tool_input.patch, .patch] | map(select(. != null)) | join("\n")' 2>/dev/null)
[ -z "$TEXT" ] && exit 0

if printf '%s' "$TEXT" | grep -Eq -- '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|(postgres|postgresql|mysql)://[^[:space:]@:/]+:[^[:space:]@/]+@|(^|[^A-Za-z0-9_])(sk_live_|rk_live_)[A-Za-z0-9]{12,}'; then
  echo "已阻止疑似真实密钥或明文数据库凭据。改用环境变量或 Secret Manager，不要写入代码、命令日志或交付物。" >&2
  exit 2
fi
exit 0

