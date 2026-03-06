#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd)
PM_SCRIPT="$REPO_ROOT/scripts/tooling/pm.sh"
cd "$REPO_ROOT"

exec sh "$PM_SCRIPT" exec tsx scripts/checks/checkDependencyCruiser.ts -- "$@"
