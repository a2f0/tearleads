#!/bin/sh
set -eu

usage() {
  cat <<EOF
Usage: $(basename "$0") [fastlane-options...]

Build the signed Android App Bundle and upload it to Google Play.

Build number:
  By default, Fastlane uses the larger of today's merged PR number and the
  latest Google Play version code plus one. Pass next_google_play:true to build
  strictly latest Google Play version code plus one, or build_number:<number>
  to set an explicit version code.

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
  $(basename "$0") next_google_play:true
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

export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.tearleads.com}"
echo "Building and uploading Android release with VITE_API_BASE_URL=$VITE_API_BASE_URL"

exec bun run android:upload:google-play "$@"
