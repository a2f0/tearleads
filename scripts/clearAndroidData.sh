#!/bin/sh
set -eu

PACKAGE_ID=${1:-"com.tearleads.rapid"}
CACHE_ONLY=${CACHE_ONLY:-""}

# Get physical device serial (exclude emulators)
DEVICE_LIST=$(adb devices 2>/dev/null | grep -w device | grep -v '^emulator-' | cut -f1)
NUM_DEVICES=$(echo "$DEVICE_LIST" | grep -c . || true)

if [ "$NUM_DEVICES" -ne 1 ]; then
    if [ "$NUM_DEVICES" -eq 0 ]; then
        echo "Error: No physical Android device connected (emulators are excluded)" >&2
    else
        echo "Error: Multiple physical devices connected. Aborting." >&2
        echo "Connected devices:" >&2
        echo "$DEVICE_LIST" >&2
    fi
    exit 1
fi

DEVICE_SERIAL=$DEVICE_LIST

echo "Using device: $DEVICE_SERIAL"

# Force stop the app first
echo "Stopping $PACKAGE_ID..."
adb -s "$DEVICE_SERIAL" shell am force-stop "$PACKAGE_ID" 2>/dev/null || true

if [ -n "$CACHE_ONLY" ]; then
    echo "Clearing cache only for $PACKAGE_ID..."
    if adb -s "$DEVICE_SERIAL" shell pm clear --cache-only "$PACKAGE_ID"; then
        echo "Successfully cleared cache for $PACKAGE_ID"
    else
        echo "Failed to clear cache. The app may not be installed." >&2
        exit 1
    fi
else
    echo "Clearing all data for $PACKAGE_ID..."
    if adb -s "$DEVICE_SERIAL" shell pm clear "$PACKAGE_ID"; then
        echo "Successfully cleared all data for $PACKAGE_ID"
    else
        echo "Failed to clear data. The app may not be installed." >&2
        exit 1
    fi
fi
