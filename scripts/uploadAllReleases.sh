#!/usr/bin/env bash
# Build and ship every SymCrypt release artifact.
#
# Runs in order:
#   1. iOS release upload to TestFlight (scripts/uploadIosRelease.sh)
#   2. Android release upload to Google Play (scripts/uploadAndroidRelease.sh)
#   3. Staging deploy, application artifacts only (--skip-infra)
#   4. Production deploy, application artifacts only (--skip-infra)
#
# The iOS step probes codesign access after Match installs its profile and only
# prompts for your macOS login password when authorization is missing. Run it
# from a real Terminal in a GUI login session in case authorization is needed.
#
# On success it prints the TestFlight build number and Google Play version code
# the two upload steps reported, followed by a per-step timing summary.

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

Reports the iOS build number and Android version code from steps 1-2, plus a
per-step timing summary, once every step succeeds.

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
BUILD_NUMBERS=()
CAPTURE_FILES=()

trap 'rm -f "${CAPTURE_FILES[@]+"${CAPTURE_FILES[@]}"}"' EXIT

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

# Same as run_step, but also records the build number the upload script reports.
#
# Scraping stdout is the only channel available: both upload scripts mktemp
# their own IOS_/ANDROID_RELEASE_BUILD_NUMBER_FILE, export it over anything we
# set, and delete it on exit, so the Fastlane-resolved number is only readable
# from the "Build number: <n>" line they echo when the upload finishes. tee
# keeps that output streaming to the terminal meanwhile; the keychain password
# prompts are written to stderr, so they stay unbuffered and visible.
run_upload_step() {
  local label="$1"
  shift
  echo "=== [$label] $* ==="
  local step_start="$SECONDS"
  local capture
  capture="$(mktemp "${TMPDIR:-/tmp}/uploadAllReleases-$label.XXXXXX")"
  CAPTURE_FILES+=("$capture")
  # pipefail (set above) makes a failing upload fail the pipeline, not tee.
  "$@" | tee "$capture"
  local elapsed="$((SECONDS - step_start))"
  local reported
  reported="$(sed -n 's/^Build number: //p' "$capture" | tail -n 1)"
  STEP_TIMINGS+=("$(printf '%-12s %s' "$label" "$(format_duration "$elapsed")")")
  BUILD_NUMBERS+=("$(printf '%-12s %s' "$label" "${reported:-not reported}")")
  echo "[$label] done in $(format_duration "$elapsed")."
  echo ""
}

print_build_number_summary() {
  echo "--- Build numbers ---"
  local row
  for row in "${BUILD_NUMBERS[@]+"${BUILD_NUMBERS[@]}"}"; do
    echo "  $row"
  done
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

echo "=== SymCrypt Full Release ==="
echo ""

# Staging store uploads are intentionally separate:
# uploadIosStagingRelease.sh and uploadAndroidStagingRelease.sh.
run_upload_step "ios" "$SCRIPT_DIR/uploadIosRelease.sh"
run_upload_step "android" "$SCRIPT_DIR/uploadAndroidRelease.sh"
run_step "staging" "$SCRIPT_DIR/deployStaging.sh" --skip-infra
run_step "production" "$SCRIPT_DIR/deployProduction.sh" --skip-infra

echo "=== Release finished ==="
echo "All steps succeeded."
echo ""
print_build_number_summary
print_timing_summary
