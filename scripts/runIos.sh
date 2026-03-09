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

# Disable audio to prevent crackling on host audio
"$SCRIPT_DIR/muteIosSimulatorAudio.sh"

BUNDLE_ID="com.tearleads.app"
DEVICE="${1:-"iPhone 16 Pro"}"

export VITE_API_URL="${VITE_API_URL:-http://localhost:3000/v1}"

sh "$PM_SCRIPT" run build && sh "$PM_SCRIPT" exec cap sync ios
xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true
# Note: Don't uninstall - it wipes app data. Use resetIosSimulator.sh for clean slate.
sh "$PM_SCRIPT" exec cap run ios --target-name "$DEVICE"
