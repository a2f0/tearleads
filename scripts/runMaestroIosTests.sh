#!/bin/sh
# Usage:
#   ./scripts/runMaestroIosTests.sh [flow]
#
# Examples:
#   ./scripts/runMaestroIosTests.sh                       # Run all flows
#   ./scripts/runMaestroIosTests.sh dark-mode-switcher.yaml
#   ./scripts/runMaestroIosTests.sh .maestro/app-loads.yaml
set -eu

export MAESTRO_CLI_NO_ANALYTICS=1

MAESTRO_CLI="${HOME}/.maestro/bin/maestro"
SIMULATOR_NAME="Maestro_iPhone11_18"
IOS_VERSION="18"
FLOW_PATH="${1:-}"

cd "$(dirname "$0")/../packages/client"

if [ -n "$FLOW_PATH" ] && [ "${FLOW_PATH#/.maestro/}" = "$FLOW_PATH" ] && [ "${FLOW_PATH#./.maestro/}" = "$FLOW_PATH" ] && [ "${FLOW_PATH#./}" = "$FLOW_PATH" ]; then
  FLOW_PATH=".maestro/${FLOW_PATH}"
fi

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
if [ -n "$FLOW_PATH" ]; then
  export MAESTRO_FLOW_PATH="$FLOW_PATH"
fi
bundle exec fastlane ios test_maestro
