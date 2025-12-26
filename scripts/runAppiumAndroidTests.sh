#!/bin/sh
set -eu

# Run Appium Android tests locally

ANDROID_VERSION="${ANDROID_VERSION:-33}"
SCRIPT_DIR="$(dirname "$0")"
cd "$SCRIPT_DIR/../packages/client"

# Check if emulator is running
if adb devices | grep -q "emulator.*device"; then
  echo "==> Android emulator is already running"
else
  echo "==> Starting Android emulator..."
  # Find available AVD
  AVD_NAME=$(emulator -list-avds | head -1)
  if [ -z "$AVD_NAME" ]; then
    echo "Error: No Android emulator AVD found. Please create one first."
    exit 1
  fi
  echo "==> Using AVD: $AVD_NAME"
  emulator -avd "$AVD_NAME" -no-audio &
  echo "==> Waiting for emulator to boot..."
  adb wait-for-device
  while [ "$(adb shell getprop sys.boot_completed 2>/dev/null)" != "1" ]; do
    sleep 1
  done
  echo "==> Emulator is ready"
fi

echo "==> Building the app..."
pnpm build

echo "==> Syncing with Capacitor..."
pnpm cap:sync

echo "==> Building, installing, and running Appium tests via Fastlane..."
bundle exec fastlane android test_appium
