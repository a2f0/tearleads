#!/bin/sh
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
PM_SCRIPT="$SCRIPT_DIR/tooling/pm.sh"

cd "$SCRIPT_DIR/../packages/client"

sh "$PM_SCRIPT" run electron:dev
