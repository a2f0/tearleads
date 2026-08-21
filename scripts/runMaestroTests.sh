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

# Device lines look like "iPhone 16 (<UDID>) (Shutdown)"; matching on
# "$1 (" keeps "iPhone 16" from also matching "iPhone 16 Pro".
# tail -1 picks the newest runtime when several carry the same device.
resolve_sim_udid() {
  xcrun simctl list devices available | grep -F "$1 (" \
    | grep -oE '[0-9A-F-]{36}' | tail -1
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
    DERIVED_DATA="${TMPDIR:-/tmp}/symcrypt-maestro-derived-data"
    xcodebuild -project ios/App/App.xcodeproj -scheme App \
      -configuration Debug -sdk iphonesimulator \
      -derivedDataPath "$DERIVED_DATA" \
      -destination 'generic/platform=iOS Simulator' \
      CODE_SIGNING_ALLOWED=NO -quiet build

    if [ -n "${MAESTRO_IOS_SIMULATOR:-}" ]; then
      # An explicit selector wins even when another simulator is booted.
      UDID="$(resolve_sim_udid "$MAESTRO_IOS_SIMULATOR")"
      if [ -z "$UDID" ]; then
        echo "No available simulator named '$MAESTRO_IOS_SIMULATOR'" >&2
        exit 1
      fi
    else
      # The booted list spans every platform; only reuse iOS simulators —
      # a booted watchOS/tvOS device cannot run the app.
      UDID="$(xcrun simctl list devices booted | awk '
        /^-- /{ios = ($0 ~ /^-- iOS /)}
        ios && match($0, /[0-9A-F-]{36}/) {print substr($0, RSTART, RLENGTH); exit}')"
      [ -n "$UDID" ] || UDID="$(resolve_sim_udid "iPhone 16")"
      if [ -z "$UDID" ]; then
        echo "No booted simulator and no available 'iPhone 16'; set MAESTRO_IOS_SIMULATOR" >&2
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
    # The flows launch with clearState: true, which wipes the app's local
    # data — never target a physical device. Run against a running emulator
    # only, and pin every adb and maestro call to its serial.
    ANDROID_SERIAL="$(adb devices | awk '$2 == "device" && $1 ~ /^emulator-/ { print $1; exit }')"
    if [ -z "$ANDROID_SERIAL" ]; then
      echo "No running Android emulator (physical devices are refused: the flows clear app state); boot one, then re-run" >&2
      exit 1
    fi
    export ANDROID_SERIAL
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
    run_flows --platform android --device "$ANDROID_SERIAL"
    ;;
  *)
    echo "Usage: $0 [ios|android]" >&2
    exit 1
    ;;
esac
