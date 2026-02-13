#!/bin/sh
# Update Android emulator to use the latest system image with modern WebView.
#
# This script recreates the Maestro test AVD with the latest Android system image
# to ensure modern JavaScript features (like Object.hasOwn) are supported in WebView.
#
# Usage:
#   ./scripts/updateAndroidEmulator.sh
#
# Requirements:
#   - Android SDK with sdkmanager and avdmanager in PATH
#   - No running emulators (script will attempt to kill them)
set -eu

# Configuration
AVD_NAME="Maestro_Pixel_6_API_35"
OLD_AVD_NAME="Maestro_Pixel_6_API_33_1"
DEVICE="pixel_6"
# Use google_apis_playstore for Play Store (auto-updates WebView) or google_apis for smaller image
SYSTEM_IMAGE="system-images;android-35;google_apis_playstore;arm64-v8a"
API_LEVEL="35"

echo "==> Updating Android emulator for Maestro tests"
echo "    AVD Name: $AVD_NAME"
echo "    System Image: $SYSTEM_IMAGE"

# Kill any running emulators
echo "==> Stopping any running emulators..."
adb emu kill 2>/dev/null || true
pkill -f "qemu.*emulator" 2>/dev/null || true
sleep 2

# Install/update the system image
echo "==> Installing system image (this may take a while)..."
yes | sdkmanager "$SYSTEM_IMAGE" || true

# Delete old AVDs if they exist
echo "==> Removing old AVDs..."
avdmanager delete avd -n "$AVD_NAME" 2>/dev/null || true
avdmanager delete avd -n "$OLD_AVD_NAME" 2>/dev/null || true

# Create new AVD
echo "==> Creating new AVD: $AVD_NAME"
echo "no" | avdmanager create avd \
    --name "$AVD_NAME" \
    --package "$SYSTEM_IMAGE" \
    --device "$DEVICE" \
    --force

# Configure AVD settings
AVD_DIR="${ANDROID_AVD_HOME:-$HOME/.android/avd}/${AVD_NAME}.avd"
AVD_CONFIG="$AVD_DIR/config.ini"

if [ -f "$AVD_CONFIG" ]; then
    echo "==> Configuring emulator settings..."
    cat >> "$AVD_CONFIG" <<'SETTINGS'
set.android.emulator.qt.window.on.top=false
fastboot.forceColdBoot=yes
fastboot.forceFastBoot=no
hw.audioInput=no
hw.audioOutput=no
hw.keyboard=yes
hw.gpu.enabled=yes
hw.gpu.mode=auto
disk.dataPartition.size=4G
SETTINGS
fi

echo ""
echo "==> Android emulator updated successfully!"
echo ""
echo "To start the emulator:"
echo "  emulator -avd $AVD_NAME"
echo ""
echo "To start headless (for CI):"
echo "  emulator -avd $AVD_NAME -no-window -no-audio -no-boot-anim"
echo ""
echo "The new emulator uses Android $API_LEVEL with a modern WebView that supports:"
echo "  - Object.hasOwn (Chrome 93+)"
echo "  - All ES2022 features"
echo "  - Modern CSS features"
