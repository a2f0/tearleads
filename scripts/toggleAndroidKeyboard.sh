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

if [ "$CURRENT" = "1" ]; then
    adb shell settings put secure show_ime_with_hard_keyboard 0
    echo "Switched to hardware keyboard input (on-screen keyboard hidden)"
else
    adb shell settings put secure show_ime_with_hard_keyboard 1
    echo "Switched to on-screen keyboard (visible)"
fi
