#!/bin/sh
# Usage:
#   ./scripts/runMaestroAndroidTests.sh [flow]
#
# Examples:
#   ./scripts/runMaestroAndroidTests.sh                       # Run all flows
#   ./scripts/runMaestroAndroidTests.sh dark-mode-switcher.yaml
#   ./scripts/runMaestroAndroidTests.sh .maestro/app-loads.yaml
set -eu

export MAESTRO_CLI_NO_ANALYTICS=1

MAESTRO_CLI="${HOME}/.maestro/bin/maestro"
ANDROID_VERSION="33"
FLOW_PATH="${1:-}"

cd "$(dirname "$0")/../packages/client"

if [ -n "$FLOW_PATH" ] && [ "${FLOW_PATH#/.maestro/}" = "$FLOW_PATH" ] && [ "${FLOW_PATH#./.maestro/}" = "$FLOW_PATH" ] && [ "${FLOW_PATH#./}" = "$FLOW_PATH" ]; then
  # Prepend ../.maestro/ since Fastlane runs from fastlane/ subdirectory
  FLOW_PATH="../.maestro/${FLOW_PATH}"
fi

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
if [ -n "$FLOW_PATH" ]; then
  export MAESTRO_FLOW_PATH="$FLOW_PATH"
fi
bundle exec fastlane android test_maestro
