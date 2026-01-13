#!/bin/sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

export CODEX_HOME="${CODEX_HOME:-"$ROOT_DIR/.claude/commands"}"

unsafe=false
args_tmp="/tmp/codex-args.$$"
trap 'rm -f "$args_tmp"' EXIT HUP INT TERM
: > "$args_tmp"

for arg in "$@"; do
  if [ "$arg" = "--unsafe" ]; then
    unsafe=true
  else
    printf '%s\n' "$arg" >> "$args_tmp"
  fi
done

set --
while IFS= read -r arg; do
  set -- "$@" "$arg"
done < "$args_tmp"

if [ "$unsafe" = true ]; then
  set -- "$@" --sandbox danger-full-access --ask-for-approval never
fi

exec codex "$@"
