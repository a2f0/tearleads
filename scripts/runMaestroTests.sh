#!/bin/sh
set -eu

# Builds the debug Capacitor app, installs it on a simulator/emulator, and runs
# every Maestro flow in packages/app-capacitor/maestro/. Automates the manual
# steps in packages/app-capacitor/maestro/README.md.
#
# Usage: scripts/runMaestroTests.sh [ios|android]   (default: ios)
PLATFORM="${1:-ios}"

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
cd "$SCRIPT_DIR/../packages/app-capacitor" || exit 1

if ! command -v maestro >/dev/null 2>&1; then
  echo "maestro not found; install with: curl -fsSL https://get.maestro.mobile.dev | bash" >&2
  exit 1
fi

run_flows() {
  for flow in maestro/*.yaml; do
    echo "Running $flow"
    maestro "$@" test "$flow"
  done
}

# The Maestro flows provision identities fully offline (no backend running),
# but Vite inlines VITE_* at build time and src/index.tsx throws on boot when
# VITE_API_BASE_URL is missing, leaving a blank WebView. Default to the local
# API address for the platform so the installed app also works interactively.
case "$PLATFORM" in
  ios)
    export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://localhost:3001}"
    bun run build
    NATIVE_RELEASE_TIER=production CAPACITOR_BUILD_CONFIGURATION=Debug \
      bunx cap sync ios
    # DerivedData must live outside the repo: its SPM checkouts are full of
    # symlinks that hang ls-lint's tree walk in the pre-commit hook (the
    # ignore list does not save it), so an in-repo path breaks git commit.
    DERIVED_DATA="${TMPDIR:-/tmp}/tearleads-maestro-derived-data"
    xcodebuild -project ios/App/App.xcodeproj -scheme App \
      -configuration Debug -sdk iphonesimulator \
      -derivedDataPath "$DERIVED_DATA" \
      -destination 'generic/platform=iOS Simulator' \
      CODE_SIGNING_ALLOWED=NO -quiet build

    UDID="$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)"
    if [ -z "$UDID" ]; then
      SIM_NAME="${MAESTRO_IOS_SIMULATOR:-iPhone 16}"
      # Device lines look like "iPhone 16 (<UDID>) (Shutdown)"; matching on
      # "$SIM_NAME (" keeps "iPhone 16" from also matching "iPhone 16 Pro".
      # tail -1 picks the newest runtime when several carry the same device.
      UDID="$(xcrun simctl list devices available | grep -F "$SIM_NAME (" \
        | grep -oE '[0-9A-F-]{36}' | tail -1)"
      if [ -z "$UDID" ]; then
        echo "No available simulator named '$SIM_NAME'; set MAESTRO_IOS_SIMULATOR" >&2
        exit 1
      fi
    fi
    xcrun simctl bootstatus "$UDID" -b
    xcrun simctl install "$UDID" \
      "$DERIVED_DATA/Build/Products/Debug-iphonesimulator/App.app"
    run_flows --platform ios --device "$UDID"
    ;;
  android)
    export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://10.0.2.2:3001}"
    if ! adb get-state >/dev/null 2>&1; then
      echo "No Android device/emulator connected; boot one, then re-run" >&2
      exit 1
    fi
    # The Gradle wrapper jar is binary, so it is gitignored rather than
    # committed; regenerate it from the mise-pinned Gradle when missing.
    if [ ! -f android/gradle/wrapper/gradle-wrapper.jar ]; then
      gradle -p android wrapper --distribution-type all
    fi
    bun run build
    NATIVE_RELEASE_TIER=production CAPACITOR_BUILD_CONFIGURATION=Debug \
      bunx cap sync android
    (cd android && ./gradlew assembleDebug)
    adb install -r android/app/build/outputs/apk/debug/app-debug.apk
    run_flows --platform android
    ;;
  *)
    echo "Usage: $0 [ios|android]" >&2
    exit 1
    ;;
esac
