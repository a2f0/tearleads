#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

# Step 3: Build and push images
"$SCRIPT_DIR/build.sh" "$@"

echo ""
echo "Step 3 complete. Images built and pushed to ECR."
echo "Next: Run ./scripts/apply04.sh to deploy containers."
echo "Terraform stack: $STACK_DIR"
