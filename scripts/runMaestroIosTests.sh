#!/bin/sh
set -eu

export MAESTRO_CLI_NO_ANALYTICS=1

MAESTRO_CLI="${HOME}/.maestro/bin/maestro"
SIMULATOR_NAME="Maestro_iPhone11_18"
IOS_VERSION="18"

cd "$(dirname "$0")/../packages/client"

if xcrun simctl list devices | grep -q "$SIMULATOR_NAME.*Booted"; then
  echo "==> Simulator $SIMULATOR_NAME is already running"
else
  echo "==> Starting iOS simulator..."
  "$MAESTRO_CLI" start-device --platform ios --os-version "$IOS_VERSION"
  echo "==> Waiting for simulator to boot..."
  xcrun simctl bootstatus "$SIMULATOR_NAME" -b
fi

echo "==> Building the app..."
pnpm build

echo "==> Syncing with Capacitor..."
pnpm cap:sync

echo "==> Building, installing, and running Maestro tests via Fastlane..."
bundle exec fastlane ios test_maestro
