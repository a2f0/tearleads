#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Step 1/4: Applying Terraform infrastructure..."
"$SCRIPT_DIR/apply01.sh" "$@"

echo ""
echo "Step 2/4: Running baseline bootstrap and deploying manifests..."
"$SCRIPT_DIR/apply02.sh"

echo ""
echo "Step 3/4: Building container images..."
"$SCRIPT_DIR/apply03.sh"

echo ""
echo "Step 4/4: Deploying containers..."
"$SCRIPT_DIR/apply04.sh"

echo ""
echo "All steps complete."
