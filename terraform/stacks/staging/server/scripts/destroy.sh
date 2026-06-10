#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

echo "This will DESTROY the staging server and ALL its resources."
echo "Waiting 5 seconds before proceeding..."
sleep 5

"$SCRIPT_DIR/init.sh"

terraform -chdir="$STACK_DIR" destroy "$@"
