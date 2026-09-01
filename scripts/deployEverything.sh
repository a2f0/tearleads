#!/usr/bin/env bash
# Build and upload every native release, then deploy every server tier.
#
# Runs in order:
#   1. Staging iOS release to TestFlight
#   2. Production iOS release to TestFlight
#   3. Staging Android release to Google Play
#   4. Production Android release to Google Play
#   5. Full staging deployment
#   6. Staging Code Assist deployment
#   7. Full production deployment
#   8. Production Code Assist deployment

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd -P)"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Builds and uploads the staging and production iOS and Android releases, then
deploys staging before production. Terraform, Ansible, and the separately
released Code Assist service are included for both tiers.

Options:
  -h, --help    Show this help and exit.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

DEPLOY_START="$SECONDS"
STEP_TIMINGS=()

format_duration() {
  local total="$1"
  printf '%dm%02ds' "$((total / 60))" "$((total % 60))"
}

run_step() {
  local label="$1"
  shift

  echo "=== [$label] $* ==="
  local step_start="$SECONDS"
  "$@"
  local elapsed="$((SECONDS - step_start))"
  STEP_TIMINGS+=("$(printf '%-20s %s' "$label" "$(format_duration "$elapsed")")")
  echo "[$label] done in $(format_duration "$elapsed")."
  echo ""
}

print_timing_summary() {
  echo "--- Timing summary ---"
  local row
  for row in "${STEP_TIMINGS[@]+"${STEP_TIMINGS[@]}"}"; do
    echo "  $row"
  done
  echo "  ----------------------------"
  printf '  %-20s %s\n' "total" "$(format_duration "$((SECONDS - DEPLOY_START))")"
}

echo "=== Tearleads Everything Deployment ==="
echo ""

run_step "ios-staging" "$SCRIPT_DIR/uploadIosStagingRelease.sh"
run_step "ios-production" "$SCRIPT_DIR/uploadIosRelease.sh"
run_step "android-staging" "$SCRIPT_DIR/uploadAndroidStagingRelease.sh"
run_step "android-production" "$SCRIPT_DIR/uploadAndroidRelease.sh"
run_step "deploy-staging" "$SCRIPT_DIR/deployStaging.sh"
run_step "code-assist-staging" \
  "$REPO_ROOT/packages/code-assist/scripts/deployStagingCodeAssist.sh"
run_step "deploy-production" "$SCRIPT_DIR/deployProduction.sh"
run_step "code-assist-production" \
  "$REPO_ROOT/packages/code-assist/scripts/deployProductionCodeAssist.sh"

echo "=== Everything deployment finished ==="
echo "All steps succeeded."
echo ""
print_timing_summary
