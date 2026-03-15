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
echo "Step 1/5: Postgres smoke test..."
"$SCRIPT_DIR/smoke01-postgres.sh"
echo "  Step 1/5 completed in $(format_duration $((SECONDS - STEP_START)))"

echo ""
STEP_START=$SECONDS
echo "Step 2/5: Postgres replica smoke test..."
"$SCRIPT_DIR/smoke02-replica.sh"
echo "  Step 2/5 completed in $(format_duration $((SECONDS - STEP_START)))"

echo ""
STEP_START=$SECONDS
echo "Step 3/5: S3 smoke test..."
"$SCRIPT_DIR/smoke03-s3.sh"
echo "  Step 3/5 completed in $(format_duration $((SECONDS - STEP_START)))"

echo ""
STEP_START=$SECONDS
echo "Step 4/5: SMTP smoke test..."
"$SCRIPT_DIR/smoke04-smtp.sh"
echo "  Step 4/5 completed in $(format_duration $((SECONDS - STEP_START)))"

echo ""
STEP_START=$SECONDS
echo "Step 5/5: API smoke test..."
"$SCRIPT_DIR/smoke05-api.sh"
echo "  Step 5/5 completed in $(format_duration $((SECONDS - STEP_START)))"

echo ""
echo "All smoke tests passed in $(format_duration $((SECONDS - TOTAL_START)))."
