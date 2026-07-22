#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .file_path // empty' 2>/dev/null)
[ -z "$FILE_PATH" ] && exit 0
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
case "$FILE_PATH" in "$ROOT"/*) ;; *) exit 0 ;; esac
case "$FILE_PATH" in */.agents/*|*/.codex/*|*/docs/*|*/work/*) exit 0 ;; esac
case "$FILE_PATH" in
  *.js|*.jsx|*.ts|*.tsx|*.css|*.scss|*.vue|*.svelte|*/schema.prisma|*/prisma/migrations/*|*Dockerfile|*.tf|*.tfvars|*.yaml|*.yml) ;;
  *) exit 0 ;;
esac
mkdir -p "$ROOT/.codex/verification"
printf 'needed\n' > "$ROOT/.codex/verification/state"
exit 0

