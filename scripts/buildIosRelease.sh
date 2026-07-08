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

export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.tearleads.com}"
echo "Building iOS release with VITE_API_BASE_URL=$VITE_API_BASE_URL"

exec bun run ios:build:testflight "$@"
