#!/bin/sh
# Usage:
#   ./scripts/runMaestroIosTests.sh [flow] [--record-video]
#
# Examples:
#   ./scripts/runMaestroIosTests.sh                       # Run all flows
#   ./scripts/runMaestroIosTests.sh dark-mode-switcher.yaml
#   ./scripts/runMaestroIosTests.sh .maestro/app-loads.yaml
#   ./scripts/runMaestroIosTests.sh --record-video
set -eu

export MAESTRO_CLI_NO_ANALYTICS=1

MAESTRO_CLI="${HOME}/.maestro/bin/maestro"
SIMULATOR_NAME="Maestro_iPhone11_18"
IOS_VERSION="18"
FLOW_PATH=""
RECORD_VIDEO=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --record-video)
      RECORD_VIDEO=1
      shift
      ;;
    --help|-h)
      echo "Usage: ./scripts/runMaestroIosTests.sh [flow] [--record-video]"
      exit 0
      ;;
    *)
      if [ -z "$FLOW_PATH" ]; then
        FLOW_PATH="$1"
      else
        echo "Unknown argument: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

cd "$(dirname "$0")/../packages/client"

if [ -n "$FLOW_PATH" ] && [ "${FLOW_PATH#/.maestro/}" = "$FLOW_PATH" ] && [ "${FLOW_PATH#./.maestro/}" = "$FLOW_PATH" ] && [ "${FLOW_PATH#./}" = "$FLOW_PATH" ]; then
  # Prepend ../.maestro/ since Fastlane runs from fastlane/ subdirectory
  FLOW_PATH="../.maestro/${FLOW_PATH}"
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
if [ "$RECORD_VIDEO" -eq 1 ]; then
  export MAESTRO_RECORD_VIDEO=1
fi
bundle exec fastlane ios test_maestro
