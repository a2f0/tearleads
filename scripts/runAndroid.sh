#!/bin/sh
set -eu

cd "$(dirname "$0")/../packages/client"

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

pnpm build && pnpm exec cap sync android
adb shell am force-stop "$PACKAGE_ID" 2>/dev/null || true
# Note: Don't uninstall - it wipes app data. Use resetAndroidEmulator.sh for clean slate.
pnpm exec cap run android --target "$DEVICE"

# Keep script running with emulator in foreground
if [ -n "${EMULATOR_PID:-}" ]; then
    echo "Emulator running (PID: $EMULATOR_PID). Press Ctrl+C to stop."
    wait "$EMULATOR_PID"
fi
