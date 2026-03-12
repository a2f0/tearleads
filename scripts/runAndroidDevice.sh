#!/bin/sh
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
PM_SCRIPT="$SCRIPT_DIR/tooling/pm.sh"

cd "$SCRIPT_DIR/../packages/client"

PACKAGE_ID=$(awk -F '[<>]' '/package_name/ {print $3}' android/app/src/main/res/values/strings.xml)
if [ -z "$PACKAGE_ID" ]; then
  echo "Error: Could not determine PACKAGE_ID from android/app/src/main/res/values/strings.xml" >&2
  exit 1
fi

# Auto-detect a connected physical device, or accept a device serial as an argument
if [ -n "${1:-}" ]; then
  DEVICE_SERIAL="$1"
else
  # List devices, exclude emulators and header/empty lines
  DEVICE_LINE=$(adb devices 2>/dev/null \
    | tail -n +2 \
    | grep -v "^$" \
    | grep -v "emulator-" \
    | grep "device$" \
    | head -1)
  if [ -z "$DEVICE_LINE" ]; then
    echo "Error: No connected Android device found. Plug in a device or pass a device serial as an argument." >&2
    echo "Run 'adb devices' to see available devices." >&2
    exit 1
  fi
  DEVICE_SERIAL=$(echo "$DEVICE_LINE" | awk '{print $1}')
  DEVICE_MODEL=$(adb -s "$DEVICE_SERIAL" shell getprop ro.product.model 2>/dev/null)
  echo "Detected device: ${DEVICE_MODEL:-unknown} ($DEVICE_SERIAL)"
fi

# Download gradle wrapper if needed (script exits early if already present)
"$PWD/scripts/downloadGradleWrapper.sh"

# Rebuild assets only if source changed or target missing
SVG_SOURCE="../ui/src/images/logo.svg"
TARGET_ASSET="android/app/src/main/res/mipmap-mdpi/ic_launcher.png"
if [ ! -f "$TARGET_ASSET" ] || [ -n "$(find "$SVG_SOURCE" -newer "$TARGET_ASSET" 2>/dev/null)" ]; then
  ./scripts/buildAndroidImageAssets.sh
fi

export VITE_API_URL="${VITE_API_URL:-http://localhost:5001/v1}"

# Forward device localhost:5001 to host localhost:5001 so API requests reach the dev server
adb -s "$DEVICE_SERIAL" reverse tcp:5001 tcp:5001

# Build web assets and sync to native project
sh "$PM_SCRIPT" run build && sh "$PM_SCRIPT" exec cap sync android

# Stop existing app instance if running
adb -s "$DEVICE_SERIAL" shell am force-stop "$PACKAGE_ID" 2>/dev/null || true

# Build and run on the physical device
sh "$PM_SCRIPT" exec cap run android --target "$DEVICE_SERIAL"
