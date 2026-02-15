#!/bin/bash
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

echo "WARNING: This will destroy GitHub repository configuration."
echo "The repository has archive_on_destroy = true, so it will be archived, not deleted."
echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
sleep 5

terraform -chdir="$STACK_DIR" destroy "$@"
