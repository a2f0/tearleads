#!/bin/sh
set -eu

# Run Appium iOS tests locally

SIMULATOR_NAME="${SIMULATOR_NAME:-iPhone 16}"
SCRIPT_DIR="$(dirname "$0")"
cd "$SCRIPT_DIR/../packages/client"

# Check if simulator is running
if xcrun simctl list devices | grep -q "$SIMULATOR_NAME.*Booted"; then
  echo "==> Simulator $SIMULATOR_NAME is already running"
else
  echo "==> Starting iOS simulator..."
  xcrun simctl boot "$SIMULATOR_NAME" || true
  echo "==> Waiting for simulator to boot..."
  xcrun simctl bootstatus "$SIMULATOR_NAME" -b
fi

echo "==> Building the app..."
pnpm build

echo "==> Syncing with Capacitor..."
pnpm cap:sync

echo "==> Building, installing, and running Appium tests via Fastlane..."
bundle exec fastlane ios test_appium
