#!/bin/sh
set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

CDPATH=''
export CDPATH

ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd -P)
cd "$ROOT_DIR"

AGENTS_FILE="AGENTS.md"
CLAUDE_FILE="CLAUDE.md"

if [ ! -f "$AGENTS_FILE" ] || [ ! -f "$CLAUDE_FILE" ]; then
  printf 'Missing %s or %s; cannot verify sync.\n' "$AGENTS_FILE" "$CLAUDE_FILE" >&2
  exit 1
fi

if ! diff -u "$CLAUDE_FILE" "$AGENTS_FILE" >/dev/null; then
  printf '%s and %s are out of sync. Run: cp %s %s\n' \
    "$CLAUDE_FILE" "$AGENTS_FILE" "$CLAUDE_FILE" "$AGENTS_FILE" >&2
  exit 1
fi
