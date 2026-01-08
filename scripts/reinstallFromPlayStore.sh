#!/bin/sh
set -eu

PACKAGE_ID=${1:-"com.tearleads.rapid"}

# Check for connected physical device (exclude emulators)
if ! adb devices 2>/dev/null | grep -E "^[^e].*device$" | grep -qv "^emulator"; then
    echo "Error: No physical Android device connected (emulators are excluded)"
    exit 1
fi

echo "Uninstalling $PACKAGE_ID..."
adb shell am force-stop "$PACKAGE_ID" 2>/dev/null || true
if adb uninstall "$PACKAGE_ID"; then
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
adb shell am start -a android.intent.action.VIEW -d "$URL"
echo "$FINAL_MESSAGE"
