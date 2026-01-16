#!/bin/sh
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

cd "$SCRIPT_DIR/../packages/client"

BUNDLE_ID="com.tearleads.rapid"
DEVICE="${1:-"iPhone 16 Pro"}"

pnpm build && pnpm exec cap sync ios
xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true
# Note: Don't uninstall - it wipes app data. Use resetIosSimulator.sh for clean slate.
pnpm exec cap run ios --target-name "$DEVICE"
