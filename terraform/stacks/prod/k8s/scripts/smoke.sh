#!/bin/bash
set -euo pipefail

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
echo "Step 1/2: Postgres (RDS) smoke test..."
"$SCRIPT_DIR/smoke01-postgres.sh"
echo "  Step 1/2 completed in $(format_duration $((SECONDS - STEP_START)))"

echo ""
STEP_START=$SECONDS
echo "Step 2/2: API smoke test..."
"$SCRIPT_DIR/smoke02-api.sh"
echo "  Step 2/2 completed in $(format_duration $((SECONDS - STEP_START)))"

echo ""
echo "All smoke tests passed in $(format_duration $((SECONDS - TOTAL_START)))."
