#!/usr/bin/env bash
# Build and ship every Tearleads release artifact.
#
# Runs in order:
#   1. iOS release upload to TestFlight (scripts/uploadIosRelease.sh)
#   2. Android release upload to Google Play (scripts/uploadAndroidRelease.sh)
#   3. Staging deploy, application artifacts only (--skip-infra)
#   4. Production deploy, application artifacts only (--skip-infra)
#
# The iOS step prompts for your macOS login password (keychain unlock and
# codesign partition list), so run this from a real Terminal in a GUI login
# session.

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Runs, in order:
  1. $(basename "$SCRIPT_DIR")/uploadIosRelease.sh
  2. $(basename "$SCRIPT_DIR")/uploadAndroidRelease.sh
  3. $(basename "$SCRIPT_DIR")/deployStaging.sh --skip-infra
  4. $(basename "$SCRIPT_DIR")/deployProduction.sh --skip-infra

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

RELEASE_START="$SECONDS"
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
  STEP_TIMINGS+=("$(printf '%-12s %s' "$label" "$(format_duration "$elapsed")")")
  echo "[$label] done in $(format_duration "$elapsed")."
  echo ""
}

print_timing_summary() {
  echo "--- Timing summary ---"
  local row
  for row in "${STEP_TIMINGS[@]+"${STEP_TIMINGS[@]}"}"; do
    echo "  $row"
  done
  echo "  ----------------------"
  printf '  %-12s %s\n' "total" "$(format_duration "$((SECONDS - RELEASE_START))")"
}

echo "=== Tearleads Full Release ==="
echo ""

run_step "ios" "$SCRIPT_DIR/uploadIosRelease.sh"
run_step "android" "$SCRIPT_DIR/uploadAndroidRelease.sh"
run_step "staging" "$SCRIPT_DIR/deployStaging.sh" --skip-infra
run_step "production" "$SCRIPT_DIR/deployProduction.sh" --skip-infra

echo "=== Release finished ==="
echo "All steps succeeded."
echo ""
print_timing_summary
