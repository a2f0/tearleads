#!/bin/sh
# Usage:
#   ./scripts/runMaestroAndroidTests.sh [--headless] [flow] [--record-video] [--video-seconds <seconds>]
#
# Examples:
#   ./scripts/runMaestroAndroidTests.sh                                  # Run all flows
#   ./scripts/runMaestroAndroidTests.sh --headless                       # Run all flows headless
#   ./scripts/runMaestroAndroidTests.sh dark-mode-switcher.yaml
#   ./scripts/runMaestroAndroidTests.sh --headless .maestro/app-loads.yaml
#   ./scripts/runMaestroAndroidTests.sh --record-video
#   ./scripts/runMaestroAndroidTests.sh --record-video --video-seconds 120
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

export MAESTRO_CLI_NO_ANALYTICS=1

MAESTRO_CLI="${HOME}/.maestro/bin/maestro"
ANDROID_VERSION="33"
HEADLESS=0
FLOW_PATH=""
RECORD_VIDEO=0
VIDEO_SECONDS=""

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
    --video-seconds)
      if [ -z "${2:-}" ]; then
        echo "Missing value for --video-seconds" >&2
        exit 1
      fi
      VIDEO_SECONDS="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: ./scripts/runMaestroAndroidTests.sh [--headless] [flow] [--record-video] [--video-seconds <seconds>]"
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

if [ -z "${ANDROID_SERIAL:-}" ]; then
  ANDROID_SERIAL="$(adb devices | awk 'NR>1 && $2=="device"{print $1}' | grep -m 1 '^emulator-' || true)"
  if [ -z "$ANDROID_SERIAL" ]; then
    ANDROID_SERIAL="$(adb devices | awk 'NR>1 && $2=="device"{print $1}' | head -n 1 || true)"
  fi
  if [ -n "$ANDROID_SERIAL" ]; then
    export ANDROID_SERIAL
  fi
fi

if [ -n "$FLOW_PATH" ] && [ "${FLOW_PATH#/.maestro/}" = "$FLOW_PATH" ] && [ "${FLOW_PATH#./.maestro/}" = "$FLOW_PATH" ] && [ "${FLOW_PATH#./}" = "$FLOW_PATH" ]; then
  # Prepend ../.maestro/ since Fastlane runs from fastlane/ subdirectory
  FLOW_PATH="../.maestro/${FLOW_PATH}"
fi

if adb devices | grep -q "emulator.*device"; then
  echo "==> Android emulator is already running"
else
  echo "==> Starting Android emulator..."
  if [ "$HEADLESS" -eq 1 ]; then
    "$MAESTRO_CLI" start-device --platform android --os-version "$ANDROID_VERSION" --headless
  else
    "$MAESTRO_CLI" start-device --platform android --os-version "$ANDROID_VERSION"
  fi
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
