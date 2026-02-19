#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Step 1/2: Applying Terraform infrastructure..."
"$SCRIPT_DIR/apply01.sh" "$@"

echo ""
echo "Step 2/2: Finalizing (no Ansible bootstrap)..."
"$SCRIPT_DIR/apply02.sh"

echo ""
echo "All steps complete."
