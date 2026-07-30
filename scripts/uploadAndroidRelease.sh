#!/bin/sh
set -eu

usage() {
  cat <<EOF
Usage: $(basename "$0") [fastlane-options...]

Build the signed Android App Bundle and upload it to Google Play.

Build number:
  By default, this script builds the next version code automatically: the
  latest Google Play version code plus one (next_google_play:true). Pass
  build_number:<number> or version_code:<number> to set an explicit version
  code instead.

Upload options:
  google_track:<track>       Play track to upload to. Defaults to internal.
  release_status:<status>    Release status. Defaults to completed.
  validate_only:true         Validate the upload without publishing.

Environment:
  VITE_API_BASE_URL           API URL inlined into the Capacitor bundle.
                              Defaults to https://api.tearleads.com.
  GOOGLE_PLAY_JSON_KEY_FILE   Path to the Google Play service account JSON key
                              (or SUPPLY_JSON_KEY). Falls back to the repo
                              default key path.

Any arguments are passed through to the app-capacitor
android:upload:google-play script, for example:
  $(basename "$0") build_number:1700
  $(basename "$0") google_track:internal validate_only:true
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

# The Gradle wrapper jar is binary, so it is gitignored rather than committed.
# Regenerate it from the repo-managed Gradle when missing so the fastlane lane
# can use ./android/gradlew where available.
WRAPPER_JAR="android/gradle/wrapper/gradle-wrapper.jar"
if [ ! -f "$WRAPPER_JAR" ]; then
  echo "Generating $WRAPPER_JAR from repo-managed Gradle..."
  if command -v gradle > /dev/null 2>&1; then
    gradle -p android wrapper --distribution-type all
  elif command -v mise > /dev/null 2>&1; then
    mise exec -- gradle -p android wrapper --distribution-type all
  else
    echo "Error: Gradle is unavailable. Run \`mise install\` from the repo root." >&2
    exit 1
  fi
fi

# shellcheck source=scripts/rejectDevOnlyUrl.sh
. "$SCRIPT_DIR/rejectDevOnlyUrl.sh"

export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.tearleads.com}"
reject_dev_only_url VITE_API_BASE_URL "$VITE_API_BASE_URL"
reject_dev_only_url VITE_WS_URL "${VITE_WS_URL:-}"
reject_invalid_revenuecat_store_key \
  VITE_REVENUECAT_ANDROID_API_KEY "${VITE_REVENUECAT_ANDROID_API_KEY:-}" goog_
echo "Building and uploading Android release with VITE_API_BASE_URL=$VITE_API_BASE_URL"

# Default to auto-incrementing from the latest Google Play version code, but
# only when the caller has not already selected a build number some other way.
# The fastlane lane reads that selection from both environment variables and CLI
# options (see packages/app-capacitor/fastlane/Fastfile.android.rb), and it
# hard-fails when next_google_play is combined with an explicit
# build_number/version_code. So skip the injection whenever any build-number
# signal is already present, in either form.
build_number_chosen=false

# Environment overrides the lane honors for build-number selection.
if [ -n "${ANDROID_BUILD_NUMBER:-}" ] \
  || [ -n "${ANDROID_VERSION_CODE:-}" ] \
  || [ -n "${ANDROID_RELEASE_NEXT_GOOGLE_PLAY:-}" ] \
  || [ -n "${ANDROID_RELEASE_MERGED_PR_NUMBER:-}" ] \
  || [ -n "${ANDROID_RELEASE_PR_NUMBER:-}" ] \
  || [ -n "${ANDROID_RELEASE_MERGED_DATE:-}" ]; then
  build_number_chosen=true
fi

# CLI options the lane honors for build-number selection.
if [ "$build_number_chosen" = false ]; then
  for arg in "$@"; do
    case "$arg" in
      build_number:* | version_code:* | next_google_play:* | merged_pr_number:* | pr_number:* | merged_date:*)
        build_number_chosen=true
        break
        ;;
    esac
  done
fi

if [ "$build_number_chosen" = false ]; then
  set -- "$@" next_google_play:true
fi

# Fastlane writes the resolved version code (build number) to this file so we can
# report it once the upload finishes. Run (not exec) so the reporting block below
# still executes after the upload.
BUILD_NUMBER_FILE="$(mktemp "${TMPDIR:-/tmp}/android-build-number.XXXXXX")"
trap 'rm -f "$BUILD_NUMBER_FILE"' EXIT
export ANDROID_RELEASE_BUILD_NUMBER_FILE="$BUILD_NUMBER_FILE"

bun run android:upload:google-play "$@"

if [ -s "$BUILD_NUMBER_FILE" ]; then
  echo "Build number: $(cat "$BUILD_NUMBER_FILE")"
else
  echo "Build number: unknown (Fastlane did not report one)"
fi
