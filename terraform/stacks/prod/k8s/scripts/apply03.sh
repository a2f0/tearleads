#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

# Step 3a: Build and push images
"$SCRIPT_DIR/build.sh" "$@"

echo ""

# Step 3b: Roll out deployments
"$SCRIPT_DIR/rollout.sh"

echo ""
echo "Step 3 complete. Latest production images are deployed."
echo "Terraform stack: $STACK_DIR"
