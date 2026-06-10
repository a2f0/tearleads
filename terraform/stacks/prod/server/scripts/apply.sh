#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

"$SCRIPT_DIR/init.sh"

terraform -chdir="$STACK_DIR" apply "$@"
