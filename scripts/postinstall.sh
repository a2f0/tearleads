#!/bin/sh
set -eu

CDPATH=''
export CDPATH

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd -P)
cd "$ROOT_DIR"

TARGET="CLAUDE.md"
LINK="AGENTS.md"

if [ ! -e "$TARGET" ]; then
  echo "postinstall: missing ${TARGET}, skipping ${LINK} symlink"
  exit 0
fi

# Keep agent instructions in one place for both tools.
ln -sf "$TARGET" "$LINK"
