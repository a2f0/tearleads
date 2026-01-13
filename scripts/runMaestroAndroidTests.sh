#!/bin/sh
# Usage:
#   ./scripts/runMaestroAndroidTests.sh [flow] [--record-video] [--video-seconds <seconds>]
#
# Examples:
#   ./scripts/runMaestroAndroidTests.sh                       # Run all flows
#   ./scripts/runMaestroAndroidTests.sh dark-mode-switcher.yaml
#   ./scripts/runMaestroAndroidTests.sh .maestro/app-loads.yaml
#   ./scripts/runMaestroAndroidTests.sh --record-video
#   ./scripts/runMaestroAndroidTests.sh --record-video --video-seconds 120
set -eu

export MAESTRO_CLI_NO_ANALYTICS=1

MAESTRO_CLI="${HOME}/.maestro/bin/maestro"
ANDROID_VERSION="33"
FLOW_PATH=""
RECORD_VIDEO=0
VIDEO_SECONDS=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --record-video)
      RECORD_VIDEO=1
      shift
      ;;
    --video-seconds)
      if [ -z "${2:-}" ]; then
        echo "Missing value for --video-seconds" >&2
        exit 1
      fi
      VIDEO_SECONDS="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: ./scripts/runMaestroAndroidTests.sh [flow] [--record-video] [--video-seconds <seconds>]"
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
if [ "$RECORD_VIDEO" -eq 1 ]; then
  export MAESTRO_RECORD_VIDEO=1
fi
if [ -n "$VIDEO_SECONDS" ]; then
  export MAESTRO_VIDEO_SECONDS="$VIDEO_SECONDS"
fi
bundle exec fastlane android test_maestro
