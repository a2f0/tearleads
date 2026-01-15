#!/bin/sh
# Copy test files to iOS simulator Documents folder for import testing
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

TEST_FILES_DIR="$SCRIPT_DIR/../.test_files"
BUNDLE_ID="${1:-com.tearleads.rapid}"

if [ ! -d "$TEST_FILES_DIR" ]; then
    echo "Error: Test files directory not found at $TEST_FILES_DIR"
    exit 1
fi

if [ -z "$(ls -A "$TEST_FILES_DIR" 2>/dev/null)" ]; then
    echo "Warning: No files found in $TEST_FILES_DIR"
    exit 0
fi

# Get the app's data container path
DATA_CONTAINER=$(xcrun simctl get_app_container booted "$BUNDLE_ID" data 2>/dev/null) || {
    echo "Error: Could not find app container. Is the app installed and simulator booted?"
    echo "Make sure the iOS simulator is running and the app is installed."
    exit 1
}

DOCUMENTS_DIR="$DATA_CONTAINER/Documents"

# Create Documents directory if it doesn't exist
mkdir -p "$DOCUMENTS_DIR"

# Copy all files recursively
echo "Copying test files to iOS simulator..."
cp -Rv "$TEST_FILES_DIR/." "$DOCUMENTS_DIR/"

echo "Done! Files copied to: $DOCUMENTS_DIR"
