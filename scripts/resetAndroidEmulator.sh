#!/bin/sh
set -eu

DEVICE="Maestro_Pixel_6_API_33_1"
AVD_CONFIG="$HOME/.android/avd/${DEVICE}.avd/config.ini"

echo "Resetting Android emulator: $DEVICE"

# Disable "always on top" behavior
if [ -f "$AVD_CONFIG" ] && ! grep -Fxq "set.android.emulator.qt.window.on.top=false" "$AVD_CONFIG"; then
    echo "Disabling always-on-top window behavior..."
    # Remove any existing line and append the correct one to ensure the setting is correct.
    # The .bak extension for sed -i is for macOS compatibility.
    sed -i.bak '/^set\.android\.emulator\.qt\.window\.on\.top=/d' "$AVD_CONFIG"
    echo "set.android.emulator.qt.window.on.top=false" >> "$AVD_CONFIG"
    rm -f "${AVD_CONFIG}.bak"
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

# Wipe emulator data by deleting userdata images directly
AVD_DIR="$HOME/.android/avd/${DEVICE}.avd"
echo "Wiping emulator data..."
rm -f "$AVD_DIR"/userdata-qemu.img*
rm -f "$AVD_DIR"/snapshots.img
rm -f "$AVD_DIR"/cache.img.qcow2

echo "Emulator reset complete. Next boot will start fresh."
