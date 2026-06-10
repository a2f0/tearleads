#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

echo "This will DESTROY the prod server and ALL its resources."
echo "Waiting 10 seconds before proceeding..."
sleep 10

"$SCRIPT_DIR/init.sh"

terraform -chdir="$STACK_DIR" destroy "$@"
