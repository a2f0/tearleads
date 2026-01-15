#!/bin/sh
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

cd "$SCRIPT_DIR/../packages/client"

PACKAGE_ID="com.tearleads.rapid"
DEVICE="Maestro_Pixel_6_API_33_1"

# Start emulator in foreground if not already running
if ! adb devices 2>/dev/null | grep -q "emulator"; then
    echo "Starting emulator: $DEVICE"
    emulator -avd "$DEVICE" &
    EMULATOR_PID=$!
    adb wait-for-device
    # shellcheck disable=SC2016
    adb shell 'while [ -z "$(getprop sys.boot_completed 2>/dev/null)" ]; do sleep 1; done'
    echo "Emulator ready"
fi

# Download gradle wrapper if needed (script exits early if already present)
"$PWD/scripts/downloadGradleWrapper.sh"

# Rebuild assets only if source changed or target missing
SVG_SOURCE="../ui/src/images/logo.svg"
TARGET_ASSET="android/app/src/main/res/mipmap-mdpi/ic_launcher.png"
if [ ! -f "$TARGET_ASSET" ] || [ -n "$(find "$SVG_SOURCE" -newer "$TARGET_ASSET" 2>/dev/null)" ]; then
  ./scripts/buildAndroidImageAssets.sh
fi
pnpm build && pnpm exec cap sync android
adb shell am force-stop "$PACKAGE_ID" 2>/dev/null || true
# Note: Don't uninstall - it wipes app data. Use resetAndroidEmulator.sh for clean slate.
pnpm exec cap run android --target "$DEVICE"

# Keep script running with emulator in foreground
if [ -n "${EMULATOR_PID:-}" ]; then
    echo "Emulator running (PID: $EMULATOR_PID). Press Ctrl+C to stop."
    wait "$EMULATOR_PID"
fi
