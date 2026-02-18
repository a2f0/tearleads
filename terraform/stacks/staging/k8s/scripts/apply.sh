#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Step 1/3: Applying Terraform infrastructure..."
"$SCRIPT_DIR/apply01.sh" "$@"

echo ""
echo "Step 2/3: Running baseline bootstrap and deploying manifests..."
"$SCRIPT_DIR/apply02.sh"

echo ""
echo "Step 3/3: Building images and rolling deployments..."
"$SCRIPT_DIR/apply03.sh"

echo ""
echo "All steps complete."
