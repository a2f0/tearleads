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

# Reject a dev-only backend URL before it is inlined into a store bundle. The
# `:-` defaults above intentionally keep an explicitly-exported public URL, but
# must not pass through a laptop's LAN address (10.x, 192.168.x, 172.16-31.x),
# loopback, or a `.local` name: those are only reachable from the build machine,
# so shipping one bakes the "webpage at 10.0.1.10:8085 is not available" failure
# into the uploaded build. A LAN-pointed release for local testing belongs in
# `bun run android:sideload:release`, not this upload lane.
reject_dev_only_url() {
  reject_name="$1"
  reject_url="$2"
  [ -n "$reject_url" ] || return 0
  reject_host="${reject_url#*://}"
  reject_host="${reject_host%%/*}"
  reject_host="${reject_host%%:*}"
  case "$reject_host" in
    localhost | 0.0.0.0 | 127.* | 10.* | 192.168.* | \
      172.1[6-9].* | 172.2[0-9].* | 172.3[01].* | *.local)
      echo "Error: $reject_name=$reject_url points at a dev-only host ($reject_host)." >&2
      echo "A Google Play release must use a public API URL (e.g. https://api.tearleads.com)." >&2
      echo "Unset $reject_name (or set it to a public URL) and re-run." >&2
      exit 1
      ;;
  esac
}

export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.tearleads.com}"
reject_dev_only_url VITE_API_BASE_URL "$VITE_API_BASE_URL"
reject_dev_only_url VITE_WS_URL "${VITE_WS_URL:-}"
echo "Building and uploading Android release with VITE_API_BASE_URL=$VITE_API_BASE_URL"

exec bun run android:upload:google-play "$@"
