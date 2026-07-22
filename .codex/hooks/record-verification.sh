#!/bin/bash
INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // .command // empty' 2>/dev/null)
EXIT_CODE=$(printf '%s' "$INPUT" | jq -r '.tool_response.exit_code // .tool_output.exit_code // .exit_code // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0
[ -z "$EXIT_CODE" ] && exit 0
CATEGORY=""
case "$CMD" in
  *typecheck*|*"tsc --noEmit"*) CATEGORY=typecheck ;;
  *" lint"*|lint|*"run lint"*) CATEGORY=lint ;;
  *" build"*|build|*"run build"*) CATEGORY=build ;;
  *"prisma validate"*|*"migrate"*) CATEGORY=migration ;;
  *playwright*|*cypress*|*" e2e"*) CATEGORY=e2e ;;
  *security*|*audit*) CATEGORY=security ;;
  *integration*) CATEGORY=integration ;;
  *" test"*|test|*vitest*|*jest*) CATEGORY=unit ;;
esac
[ -z "$CATEGORY" ] && exit 0
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
mkdir -p "$ROOT/.codex/verification"
jq -cn --arg category "$CATEGORY" --arg command "$CMD" --arg checked_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson exit_code "$EXIT_CODE" '{category:$category,command:$command,exit_code:$exit_code,checked_at:$checked_at}' >> "$ROOT/.codex/verification/results.jsonl"
exit 0

