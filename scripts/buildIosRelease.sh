#!/bin/sh
set -eu

usage() {
  cat <<EOF
Usage: $(basename "$0") [fastlane-options...]

Build the signed iOS IPA for TestFlight.

Build number:
  By default, Fastlane uses the larger of today's merged PR number and the
  latest TestFlight build number plus one. Pass next_testflight:true to build
  strictly latest TestFlight build number plus one, or build_number:<number>
  to set an explicit build number.

Environment:
  VITE_API_BASE_URL  API URL inlined into the Capacitor bundle.
                     Defaults to https://api.tearleads.com.

Any arguments are passed through to the app-capacitor ios:build:testflight
script, for example:
  $(basename "$0") next_testflight:true
  $(basename "$0") build_number:123
EOF
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
cd "$SCRIPT_DIR/../packages/app-capacitor" || exit 1

# shellcheck source=scripts/rejectDevOnlyUrl.sh
. "$SCRIPT_DIR/rejectDevOnlyUrl.sh"

export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.tearleads.com}"
reject_dev_only_url VITE_API_BASE_URL "$VITE_API_BASE_URL"
reject_dev_only_url VITE_WS_URL "${VITE_WS_URL:-}"
reject_invalid_revenuecat_store_key \
  VITE_REVENUECAT_IOS_API_KEY "${VITE_REVENUECAT_IOS_API_KEY:-}" appl_
echo "Building iOS release with VITE_API_BASE_URL=$VITE_API_BASE_URL"

exec bun run ios:build:testflight "$@"
