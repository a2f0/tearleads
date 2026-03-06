#!/bin/sh
set -eu

if ! command -v adb >/dev/null; then
    echo "Error: 'adb' command not found. Please ensure Android SDK Platform-Tools are installed and in your PATH." >&2
    exit 1
fi

PACKAGE_ID=${1:-"com.tearleads.app"}

# Get physical device serial (exclude emulators)
DEVICE_LIST=$(adb devices | grep -w device | grep -v '^emulator-' | cut -f1)
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

URL="${ANDROID_INTERNAL_TESTING_URL:-https://play.google.com/console/u/0/developers/6730555694724333630/app/4972033296946871834/tracks/internal-testing}"
OPENING_MESSAGE="Opening internal testing URL..."
FINAL_MESSAGE="Done. Please tap 'Install' on the internal testing page to reinstall the app."

echo "$OPENING_MESSAGE"
adb -s "$DEVICE_SERIAL" shell am start -a android.intent.action.VIEW -d "$URL"
echo "$FINAL_MESSAGE"
