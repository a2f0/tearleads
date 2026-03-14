#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PM_SCRIPT="$SCRIPT_DIR/tooling/pm.sh"

cd "$SCRIPT_DIR/../packages/client"
sh "$PM_SCRIPT" run screenshots "$@"
