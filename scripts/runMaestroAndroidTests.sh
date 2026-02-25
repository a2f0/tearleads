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

# Android Maestro lanes require gradle-wrapper.jar, which is gitignored.
# Ensure it is present before invoking any Gradle/Fastlane tasks.
./scripts/downloadGradleWrapper.sh

if [ -n "$FLOW_PATH" ] && [ "${FLOW_PATH#/.maestro/}" = "$FLOW_PATH" ] && [ "${FLOW_PATH#./.maestro/}" = "$FLOW_PATH" ] && [ "${FLOW_PATH#./}" = "$FLOW_PATH" ]; then
  # Prepend ../.maestro/ since Fastlane runs from fastlane/ subdirectory
  FLOW_PATH="../.maestro/${FLOW_PATH}"
fi

find_connected_emulator() {
  adb devices | awk 'NR>1 && $2=="device" && $1 ~ /^emulator-/ { print $1; exit }'
}

is_serial_connected() {
  serial="$1"
  if [ -z "$serial" ]; then
    return 1
  fi
  adb devices | awk 'NR>1 && $2=="device" { print $1 }' | grep -qx "$serial"
}

if [ -n "${ANDROID_SERIAL:-}" ] && ! is_serial_connected "$ANDROID_SERIAL"; then
  echo "Warning: ANDROID_SERIAL=$ANDROID_SERIAL is not currently connected; will auto-detect emulator." >&2
  unset ANDROID_SERIAL
fi

EMULATOR_SERIAL="$(find_connected_emulator || true)"
if [ -n "$EMULATOR_SERIAL" ]; then
  echo "==> Android emulator is already running"
else
  echo "==> Starting Android emulator..."
  # Find an available AVD
  AVD_NAME=$(emulator -list-avds | head -n 1)
  if [ -z "$AVD_NAME" ]; then
    echo "Error: No Android AVDs found. Create one with Android Studio or avdmanager." >&2
    exit 1
  fi
  echo "==> Using AVD: $AVD_NAME"
  if [ "$HEADLESS" -eq 1 ]; then
    emulator -avd "$AVD_NAME" -no-window -no-audio -no-boot-anim &
  else
    emulator -avd "$AVD_NAME" &
  fi

  echo "==> Waiting for emulator to be available..."
  EMULATOR_SERIAL=""
  wait_seconds=0
  while [ -z "$EMULATOR_SERIAL" ] && [ "$wait_seconds" -lt 180 ]; do
    EMULATOR_SERIAL="$(find_connected_emulator || true)"
    if [ -n "$EMULATOR_SERIAL" ]; then
      break
    fi
    sleep 1
    wait_seconds=$((wait_seconds + 1))
  done
  if [ -z "$EMULATOR_SERIAL" ]; then
    echo "Error: Timed out waiting for Android emulator device to connect." >&2
    adb devices >&2 || true
    exit 1
  fi

  echo "==> Waiting for emulator boot completion on $EMULATOR_SERIAL..."
  adb -s "$EMULATOR_SERIAL" wait-for-device
  while [ "$(adb -s "$EMULATOR_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
    sleep 1
  done

  echo "==> Emulator is ready"
fi

if [ -z "${ANDROID_SERIAL:-}" ]; then
  if [ -n "$EMULATOR_SERIAL" ]; then
    ANDROID_SERIAL="$EMULATOR_SERIAL"
  else
    ANDROID_SERIAL="$(adb devices | awk 'NR>1 && $2=="device"{print $1}' | head -n 1 || true)"
  fi
fi

if [ -z "$ANDROID_SERIAL" ]; then
  echo "Error: No connected Android device/emulator detected." >&2
  adb devices >&2 || true
  exit 1
fi

if ! is_serial_connected "$ANDROID_SERIAL"; then
  echo "Error: Selected Android serial '$ANDROID_SERIAL' is not connected." >&2
  adb devices >&2 || true
  exit 1
fi

export ANDROID_SERIAL
echo "==> Using Android serial: $ANDROID_SERIAL"

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
