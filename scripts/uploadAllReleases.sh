#!/usr/bin/env bash
# Build and ship every Tearleads release artifact.
#
# Runs in order:
#   1. iOS release upload to TestFlight (scripts/uploadIosRelease.sh)
#   2. Android release upload to Google Play (scripts/uploadAndroidRelease.sh)
#   3. Staging deploy, application artifacts only (--skip-infra)
#   4. Production deploy, application artifacts only (--skip-infra)
#
# The iOS steps isolate Match signing assets in random-password keychains that
# are deleted after each archive, so they do not need the login keychain password.
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

BUILD_NUMBERS=()
CAPTURE_FILES=()

trap 'rm -f "${CAPTURE_FILES[@]+"${CAPTURE_FILES[@]}"}"' EXIT

# shellcheck source=stepTimings.sh
# shellcheck disable=SC1091
. "$SCRIPT_DIR/stepTimings.sh"
step_timings_reset

# Same as step_timings_run, but also records the build number the upload script
# reports.
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
  step_timings_begin "$label" "$@"
  local capture
  capture="$(mktemp "${TMPDIR:-/tmp}/uploadAllReleases-$label.XXXXXX")"
  CAPTURE_FILES+=("$capture")
  # pipefail (set above) makes a failing upload fail the pipeline, not tee.
  "$@" | tee "$capture"
  local reported
  reported="$(sed -n 's/^Build number: //p' "$capture" | tail -n 1)"
  BUILD_NUMBERS+=("$(printf '%-12s %s' "$label" "${reported:-not reported}")")
  step_timings_end
}

print_build_number_summary() {
  echo "--- Build numbers ---"
  local row
  for row in "${BUILD_NUMBERS[@]+"${BUILD_NUMBERS[@]}"}"; do
    echo "  $row"
  done
  echo ""
}

echo "=== Tearleads Full Release ==="
echo ""

# Staging store uploads are intentionally separate:
# uploadIosStagingRelease.sh and uploadAndroidStagingRelease.sh.
run_upload_step "ios" "$SCRIPT_DIR/uploadIosRelease.sh"
run_upload_step "android" "$SCRIPT_DIR/uploadAndroidRelease.sh"
step_timings_run "staging" "$SCRIPT_DIR/deployStaging.sh" --skip-infra
step_timings_run "production" "$SCRIPT_DIR/deployProduction.sh" --skip-infra

echo "=== Release finished ==="
echo "All steps succeeded."
echo ""
print_build_number_summary
step_timings_summary
