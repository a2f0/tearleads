#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

echo "WARNING: This will destroy the staging TEE infrastructure."
echo "This includes the Confidential VM and Key Vault."
echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
sleep 5

terraform -chdir="$STACK_DIR" destroy "$@"
