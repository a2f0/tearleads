#!/bin/sh
# Copy test files to Android emulator Documents folder for import testing
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

TEST_FILES_DIR="$SCRIPT_DIR/../.test_files"

if [ ! -d "$TEST_FILES_DIR" ]; then
    echo "Error: Test files directory not found at $TEST_FILES_DIR"
    exit 1
fi

if [ -z "$(ls -A "$TEST_FILES_DIR" 2>/dev/null)" ]; then
    echo "Warning: No files found in $TEST_FILES_DIR"
    exit 0
fi

# Check if emulator is running
if ! adb devices 2>/dev/null | grep -q "emulator"; then
    echo "Error: No Android emulator detected. Please start an emulator first."
    exit 1
fi

# Android shared Documents directory (accessible via file picker)
# Using Download folder as it's accessible from most file picker intents
ANDROID_DOCS_DIR="/sdcard/Download"

echo "Copying test files to Android emulator..."

# Push files recursively. The "/." ensures the contents of the directory are copied.
adb push "$TEST_FILES_DIR/." "$ANDROID_DOCS_DIR/"

# Trigger media scan so files appear in file pickers
# Note: MEDIA_SCANNER_SCAN_FILE scans a single path; files may take time to appear in pickers
echo "Triggering media scan..."
adb shell "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://$ANDROID_DOCS_DIR"

echo "Done! Files copied to: $ANDROID_DOCS_DIR"
