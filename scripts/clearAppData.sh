#!/bin/sh
set -eu

PACKAGE_ID=${1:-"com.tearleads.rapid"}

# Check for connected device
if ! adb devices 2>/dev/null | grep -q "device$"; then
    echo "Error: No Android device connected"
    exit 1
fi

echo "Stopping $PACKAGE_ID..."
adb shell am force-stop "$PACKAGE_ID" 2>/dev/null || true

echo "Clearing app data for $PACKAGE_ID..."
if adb shell pm clear "$PACKAGE_ID"; then
    echo "Successfully cleared app data for $PACKAGE_ID"
    echo "Note: This clears EncryptedSharedPreferences (encryption secret) and all local data."
else
    echo "Failed to clear app data. Is the app installed?"
    exit 1
fi
