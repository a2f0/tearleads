#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

format_duration() {
  local total_seconds=$1
  local minutes=$((total_seconds / 60))
  local seconds=$((total_seconds % 60))
  if [ "$minutes" -gt 0 ]; then
    printf "%dm %ds" "$minutes" "$seconds"
  else
    printf "%ds" "$seconds"
  fi
}

TOTAL_START=$SECONDS

STEP_START=$SECONDS
echo "Step 1/4: Applying Terraform infrastructure..."
"$SCRIPT_DIR/apply01-terraform.sh" "$@"
echo "  Step 1/4 completed in $(format_duration $((SECONDS - STEP_START)))"

echo ""
STEP_START=$SECONDS
echo "Step 2/4: Running baseline bootstrap and deploying manifests..."
"$SCRIPT_DIR/apply02-bootstrap-cluster.sh"
echo "  Step 2/4 completed in $(format_duration $((SECONDS - STEP_START)))"

echo ""
STEP_START=$SECONDS
echo "Step 3/4: Building container images..."
"$SCRIPT_DIR/apply03-build-images.sh"
echo "  Step 3/4 completed in $(format_duration $((SECONDS - STEP_START)))"

echo ""
STEP_START=$SECONDS
echo "Step 4/4: Deploying containers..."
"$SCRIPT_DIR/apply04-rollout-containers.sh"
echo "  Step 4/4 completed in $(format_duration $((SECONDS - STEP_START)))"

echo ""
echo "All steps complete in $(format_duration $((SECONDS - TOTAL_START)))."
