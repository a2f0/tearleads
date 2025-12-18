#!/bin/sh
set -eu

export MAESTRO_CLI_NO_ANALYTICS=1

MAESTRO_CLI="${HOME}/.maestro/bin/maestro"
ANDROID_VERSION="33"

cd "$(dirname "$0")/.."

if adb devices | grep -q "emulator.*device"; then
  echo "==> Android emulator is already running"
else
  echo "==> Starting Android emulator..."
  "$MAESTRO_CLI" start-device --platform android --os-version "$ANDROID_VERSION"
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

echo "==> Building, installing, and running Maestro tests via Fastlane..."
bundle exec fastlane android test_maestro
