#!/bin/sh
# Usage:
#   ./scripts/runMaestroIosTests.sh [--headless] [flow] [--record-video]
#
# Examples:
#   ./scripts/runMaestroIosTests.sh                                  # Run all flows
#   ./scripts/runMaestroIosTests.sh --headless                       # Run all flows headless
#   ./scripts/runMaestroIosTests.sh dark-mode-switcher.yaml
#   ./scripts/runMaestroIosTests.sh --headless .maestro/app-loads.yaml
#   ./scripts/runMaestroIosTests.sh --record-video
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

export MAESTRO_CLI_NO_ANALYTICS=1

MAESTRO_CLI="${HOME}/.maestro/bin/maestro"
SIMULATOR_NAME="Maestro_iPhone11_18"
IOS_VERSION="18"
HEADLESS=0
FLOW_PATH=""
RECORD_VIDEO=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --)
      shift
      ;;
    --headless)
      HEADLESS=1
      shift
      ;;
    --record-video)
      RECORD_VIDEO=1
      shift
      ;;
    --help|-h)
      echo "Usage: ./scripts/runMaestroIosTests.sh [--headless] [flow] [--record-video]"
      exit 0
      ;;
    *)
      if [ -z "$FLOW_PATH" ]; then
        FLOW_PATH="$1"
        shift
      else
        echo "Unknown argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

cd "$SCRIPT_DIR/../packages/client"

if [ -n "$FLOW_PATH" ] && [ "${FLOW_PATH#/.maestro/}" = "$FLOW_PATH" ] && [ "${FLOW_PATH#./.maestro/}" = "$FLOW_PATH" ] && [ "${FLOW_PATH#./}" = "$FLOW_PATH" ]; then
  # Prepend ../.maestro/ since Fastlane runs from fastlane/ subdirectory
  FLOW_PATH="../.maestro/${FLOW_PATH}"
fi

if xcrun simctl list devices | grep -q "$SIMULATOR_NAME.*Booted"; then
  echo "==> Simulator $SIMULATOR_NAME is already running"
else
  echo "==> Starting iOS simulator..."
  if [ "$HEADLESS" -eq 1 ]; then
    "$MAESTRO_CLI" start-device --platform ios --os-version "$IOS_VERSION" --headless
  else
    "$MAESTRO_CLI" start-device --platform ios --os-version "$IOS_VERSION"
  fi
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
