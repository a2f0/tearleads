#!/usr/bin/env bash
# Deploy every staging target, publish its native releases, then promote the
# same release to production.
#
# Runs in order:
#   1. Staging infrastructure, Workers, and native releases
#   2. Production infrastructure, Workers, and native releases

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd -P)"

usage() {
  cat <<USAGE
Usage: $(basename "$0")

Deploys and publishes every staging target before promoting the same release
to production. Terraform, Workers, and both native stores are included.

Options:
  -h, --help    Show this help and exit.
USAGE
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

cd "$REPO_ROOT"

# shellcheck source=scripts/lib/stepTimings.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/scripts/lib/stepTimings.sh"
step_timings_reset

echo "=== Tearleads Everything Deployment ==="
echo ""

step_timings_run "deploy-staging" "$SCRIPT_DIR/deployStaging.sh"
step_timings_run "ios-staging" "$SCRIPT_DIR/../release/uploadIosStagingRelease.sh"
step_timings_run "android-staging" "$SCRIPT_DIR/../release/uploadAndroidStagingRelease.sh"

step_timings_run "deploy-production" "$SCRIPT_DIR/deployProduction.sh"
step_timings_run "ios-production" "$SCRIPT_DIR/../release/uploadIosRelease.sh"
step_timings_run "android-production" "$SCRIPT_DIR/../release/uploadAndroidRelease.sh"

echo "=== Everything deployment finished ==="
echo "All steps succeeded."
echo ""
step_timings_summary
