#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

# Step 4: Roll out deployments
"$SCRIPT_DIR/rollout.sh"

echo ""
echo "Step 4 complete. Latest staging images are deployed."
echo "Terraform stack: $STACK_DIR"
