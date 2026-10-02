#!/usr/bin/env bash
# Publish the npm modules needed by the standalone windowing extraction.
# Windowing has no workspace dependencies, so it is the entire publish set.
set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
exec "$SCRIPT_DIR/publishWindowing.sh" "$@"
