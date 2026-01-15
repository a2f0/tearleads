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

TARGET="CLAUDE.md"
LINK="AGENTS.md"

if [ ! -e "$TARGET" ]; then
  printf 'postinstall: missing %s, skipping %s symlink\n' "$TARGET" "$LINK"
  exit 0
fi

# Keep agent instructions in one place for both tools.
ln -sf "$TARGET" "$LINK"
