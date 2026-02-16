#!/bin/bash
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

echo "WARNING: This will destroy the production RDS database!"
echo "Data will be lost unless you have backups."
echo "Press Ctrl+C to cancel, or wait 10 seconds to continue..."
sleep 10

terraform -chdir="$STACK_DIR" destroy "$@"
