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

SIMULATOR_NAME="Maestro_iPhone11_18"
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

# Disable audio to prevent crackling on host audio
"$SCRIPT_DIR/muteIosSimulatorAudio.sh"

if xcrun simctl list devices | grep -q "$SIMULATOR_NAME.*Booted"; then
  echo "==> Simulator $SIMULATOR_NAME is already running"
else
  echo "==> Starting iOS simulator..."
  # Get the UDID of the simulator
  SIMULATOR_UDID=$(xcrun simctl list devices -j | grep -A2 "\"name\" : \"$SIMULATOR_NAME\"" | grep udid | head -1 | sed 's/.*: "\(.*\)".*/\1/' || true)
  if [ -z "$SIMULATOR_UDID" ]; then
    # Fallback: try to find any available iPhone simulator
    SIMULATOR_UDID=$(xcrun simctl list devices available -j | grep -B2 '"isAvailable" : true' | grep udid | head -1 | sed 's/.*: "\(.*\)".*/\1/' || true)
  fi
  if [ -z "$SIMULATOR_UDID" ]; then
    echo "Error: Could not find simulator $SIMULATOR_NAME or any available iPhone simulator" >&2
    exit 1
  fi
  echo "==> Using simulator UDID: $SIMULATOR_UDID"
  # Boot the simulator (runs headless by default via simctl)
  xcrun simctl boot "$SIMULATOR_UDID" 2>/dev/null || true
  if [ "$HEADLESS" -eq 0 ]; then
    # Open Simulator.app to show the UI
    open -a Simulator
  fi
  echo "==> Waiting for simulator to boot..."
  xcrun simctl bootstatus "$SIMULATOR_UDID" -b
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
