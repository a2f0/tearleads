#!/bin/sh
set -eu

DEVICE="Maestro_Pixel_6_API_33_1"
AVD_CONFIG="$HOME/.android/avd/${DEVICE}.avd/config.ini"

echo "Resetting Android emulator: $DEVICE"

# Disable "always on top" behavior
if ! grep -q "set.android.emulator.qt.window.on.top" "$AVD_CONFIG" 2>/dev/null; then
    echo "Disabling always-on-top window behavior..."
    echo "set.android.emulator.qt.window.on.top=false" >> "$AVD_CONFIG"
fi

# Kill any running emulator
if adb devices 2>/dev/null | grep -q "emulator"; then
    echo "Stopping running emulator..."
    adb emu kill 2>/dev/null || true
    sleep 2
fi

# Kill any orphaned emulator processes
pkill -f "qemu.*$DEVICE" 2>/dev/null || true
sleep 1

# Wipe emulator data and restart
# -no-snapshot-save: prevents saving state on shutdown
# -no-boot-anim: faster startup
echo "Wiping emulator data and starting fresh..."
emulator -avd "$DEVICE" -wipe-data -no-snapshot-save -no-boot-anim &
EMULATOR_PID=$!

echo "Waiting for emulator to boot..."
adb wait-for-device
# shellcheck disable=SC2016
adb shell 'while [ -z "$(getprop sys.boot_completed 2>/dev/null)" ]; do sleep 1; done'

echo "Emulator reset complete and ready (PID: $EMULATOR_PID)"
