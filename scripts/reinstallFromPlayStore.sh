#!/bin/sh
set -eu

PACKAGE_ID=${1:-"com.tearleads.rapid"}

# Check for connected device
if ! adb devices 2>/dev/null | grep -q "device$"; then
    echo "Error: No Android device connected"
    exit 1
fi

echo "Uninstalling $PACKAGE_ID..."
adb shell am force-stop "$PACKAGE_ID" 2>/dev/null || true
if adb uninstall "$PACKAGE_ID"; then
    echo "Successfully uninstalled $PACKAGE_ID"
else
    echo "App was not installed or uninstall failed. Continuing..."
fi

if [ -n "${ANDROID_INTERNAL_TESTING_URL:-}" ]; then
    echo "Opening internal testing URL..."
    adb shell am start -a android.intent.action.VIEW -d "$ANDROID_INTERNAL_TESTING_URL"
    echo "Done. Please tap 'Install' on the internal testing page to reinstall the app."
else
    echo "Opening Play Store..."
    adb shell am start -a android.intent.action.VIEW -d "market://details?id=$PACKAGE_ID"
    echo "Done. Please tap 'Install' in the Play Store to reinstall the app."
fi
