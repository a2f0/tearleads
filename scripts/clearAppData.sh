#!/bin/sh
set -eu

PACKAGE_ID=${1:-"com.tearleads.rapid"}

# Check for connected device
device_count=$(adb devices 2>/dev/null | grep "device$" | wc -l)
if [ "$device_count" -eq 0 ]; then
    echo "Error: No Android device connected" >&2
    exit 1
elif [ "$device_count" -gt 1 ]; then
    echo "Error: Multiple devices connected. Please target a specific device." >&2
    adb devices >&2
    exit 1
fi

echo "Stopping $PACKAGE_ID..."
adb shell am force-stop "$PACKAGE_ID" 2>/dev/null || true

echo "Clearing app data for $PACKAGE_ID..."
if adb shell pm clear "$PACKAGE_ID"; then
    echo "Successfully cleared app data for $PACKAGE_ID"
    echo "Note: This clears EncryptedSharedPreferences (encryption secret) and all local data."
else
    echo "Failed to clear app data. Is the app installed?" >&2
    exit 1
fi
