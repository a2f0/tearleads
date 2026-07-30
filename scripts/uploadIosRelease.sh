#!/bin/sh
set -eu

usage() {
  cat <<EOF
Usage: $(basename "$0") [fastlane-options...]

Build the signed iOS IPA and upload it to App Store Connect (TestFlight).

Build number:
  By default, this script builds the next build number automatically: the
  latest TestFlight build number plus one (next_testflight:true). Pass
  build_number:<number> or apple_build_number:<number> to set an explicit build
  number instead.

Upload options:
  changelog:<text>            "What to Test" notes for the TestFlight build.
  distribute_external:true    Distribute to external testers (requires groups).
  groups:<name,name>          External TestFlight groups to distribute to.
  skip_submission:true        Upload the build without submitting it for review.

Signing keychain:
  Before building, this script runs scripts/keychain/unlockLoginKeychain.sh and
  scripts/keychain/authorizeCodesignPartitionList.sh so codesign can use the
  iOS signing key without a GUI prompt mid-archive. Both prompt for your macOS
  login password on the terminal (input hidden), so run this from a real
  Terminal in a GUI login session.

Environment:
  VITE_API_BASE_URL           API URL inlined into the Capacitor bundle.
                              Defaults to https://api.tearleads.com.

  The Fastlane lane reads App Store Connect credentials
  (APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID) and the signing team
  id (TEAM_ID) from .secrets/root.env, and the App Store Connect API key from
  .secrets/AuthKey_<APP_STORE_CONNECT_KEY_ID>.p8.

  The release regenerates the app icon and splash from assets/logo.svg during
  the build, so ImageMagick must be installed (the magick command, or legacy
  convert).

Any arguments are passed through to the app-capacitor ios:upload:testflight
script, for example:
  $(basename "$0") build_number:1700
  $(basename "$0") distribute_external:true groups:Beta
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
reject_test_store_key VITE_REVENUECAT_IOS_API_KEY "${VITE_REVENUECAT_IOS_API_KEY:-}"
echo "Building and uploading iOS release with VITE_API_BASE_URL=$VITE_API_BASE_URL"

# Prepare the signing keychain up front so the password prompts happen now,
# rather than as a GUI dialog partway through the archive. Both scripts read the
# password interactively from this terminal, so they inherit our stdin/tty.
"$SCRIPT_DIR/keychain/unlockLoginKeychain.sh"
"$SCRIPT_DIR/keychain/authorizeCodesignPartitionList.sh"

# Default to auto-incrementing from the latest TestFlight build number, but only
# when the caller has not already selected a build number some other way. The
# fastlane lane reads that selection from both environment variables and CLI
# options (see packages/app-capacitor/fastlane/Fastfile.ios.rb), and it
# hard-fails when next_testflight is combined with an explicit
# build_number/apple_build_number. So skip the injection whenever any
# build-number signal is already present, in either form.
build_number_chosen=false

# Environment overrides the lane honors for build-number selection.
if [ -n "${IOS_BUILD_NUMBER:-}" ] \
  || [ -n "${APPLE_BUILD_NUMBER:-}" ] \
  || [ -n "${IOS_RELEASE_NEXT_TESTFLIGHT:-}" ] \
  || [ -n "${IOS_RELEASE_MERGED_PR_NUMBER:-}" ] \
  || [ -n "${IOS_RELEASE_PR_NUMBER:-}" ] \
  || [ -n "${IOS_RELEASE_MERGED_DATE:-}" ]; then
  build_number_chosen=true
fi

# CLI options the lane honors for build-number selection.
if [ "$build_number_chosen" = false ]; then
  for arg in "$@"; do
    case "$arg" in
      build_number:* | apple_build_number:* | next_testflight:* | merged_pr_number:* | pr_number:* | merged_date:*)
        build_number_chosen=true
        break
        ;;
    esac
  done
fi

if [ "$build_number_chosen" = false ]; then
  set -- "$@" next_testflight:true
fi

# Fastlane writes the resolved build number to this file so we can report it once
# the upload finishes. Run (not exec) so the reporting block below still executes
# after the upload.
BUILD_NUMBER_FILE="$(mktemp "${TMPDIR:-/tmp}/ios-build-number.XXXXXX")"
trap 'rm -f "$BUILD_NUMBER_FILE"' EXIT
export IOS_RELEASE_BUILD_NUMBER_FILE="$BUILD_NUMBER_FILE"

bun run ios:upload:testflight "$@"

if [ -s "$BUILD_NUMBER_FILE" ]; then
  echo "Build number: $(cat "$BUILD_NUMBER_FILE")"
else
  echo "Build number: unknown (Fastlane did not report one)"
fi
