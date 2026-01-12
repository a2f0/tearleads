#!/bin/sh
set -eu

if ! command -v adb >/dev/null; then
    echo "Error: 'adb' command not found. Please ensure Android SDK Platform-Tools are installed and in your PATH." >&2
    exit 1
fi

PACKAGE_ID=${1:-"com.tearleads.rapid"}

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

echo "Uninstalling $PACKAGE_ID..."
adb -s "$DEVICE_SERIAL" shell am force-stop "$PACKAGE_ID" 2>/dev/null || true
if adb -s "$DEVICE_SERIAL" uninstall "$PACKAGE_ID"; then
    echo "Successfully uninstalled $PACKAGE_ID"
else
    echo "App was not installed or uninstall failed. Continuing..."
fi

URL="market://details?id=$PACKAGE_ID"
OPENING_MESSAGE="Opening Play Store..."
FINAL_MESSAGE="Done. Please tap 'Install' in the Play Store to reinstall the app."

if [ -n "${ANDROID_INTERNAL_TESTING_URL:-}" ]; then
    URL="$ANDROID_INTERNAL_TESTING_URL"
    OPENING_MESSAGE="Opening internal testing URL..."
    FINAL_MESSAGE="Done. Please tap 'Install' on the internal testing page to reinstall the app."
fi

echo "$OPENING_MESSAGE"
adb -s "$DEVICE_SERIAL" shell am start -a android.intent.action.VIEW -d "$URL"
echo "$FINAL_MESSAGE"
