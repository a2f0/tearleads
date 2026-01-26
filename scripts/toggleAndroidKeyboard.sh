#!/bin/sh
set -eu

# Check if emulator is running
if ! adb devices 2>/dev/null | grep -q "emulator"; then
    echo "Error: No emulator detected. Start the emulator first."
    exit 1
fi

# Get current setting (default to 0 if not set)
CURRENT=$(adb shell settings get secure show_ime_with_hard_keyboard 2>/dev/null || echo "0")
CURRENT=$(echo "$CURRENT" | tr -d '[:space:]')

TARGET="1"
MESSAGE="Switched to on-screen keyboard (visible)"
if [ "$CURRENT" = "1" ]; then
    TARGET="0"
    MESSAGE="Switched to hardware keyboard input (on-screen keyboard hidden)"
fi
adb shell settings put secure show_ime_with_hard_keyboard "$TARGET"
echo "$MESSAGE"
