#!/bin/sh
set -eu

usage() {
  cat <<EOF
Usage: $(basename "$0") [fastlane-options...]

Build the signed Android App Bundle for Google Play.

Build number:
  By default, Fastlane uses the larger of today's merged PR number and the
  latest Google Play version code plus one. Pass next_google_play:true to build
  strictly latest Google Play version code plus one, or build_number:<number>
  to set an explicit version code.

Environment:
  VITE_API_BASE_URL  API URL inlined into the Capacitor bundle.
                     Defaults to https://api.tearleads.com.

Any arguments are passed through to the app-capacitor android:build:google-play
script, for example:
  $(basename "$0") next_google_play:true
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
echo "Building Android release with VITE_API_BASE_URL=$VITE_API_BASE_URL"

exec bun run android:build:google-play "$@"
