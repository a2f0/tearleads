#!/bin/sh
# Copy test files to Android emulator Documents folder for import testing
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
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

# Push files recursively
find "$TEST_FILES_DIR" -type f | while read -r file; do
    relative_path="${file#"$TEST_FILES_DIR"/}"
    target_dir="$ANDROID_DOCS_DIR/$(dirname "$relative_path")"

    # Create directory structure on device
    adb shell "mkdir -p '$target_dir'" 2>/dev/null || true

    # Push the file
    echo "Copying: $relative_path"
    adb push "$file" "$ANDROID_DOCS_DIR/$relative_path"
done

# Trigger media scan so files appear in file pickers
echo "Triggering media scan..."
adb shell "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://$ANDROID_DOCS_DIR"

echo "Done! Files copied to: $ANDROID_DOCS_DIR"
