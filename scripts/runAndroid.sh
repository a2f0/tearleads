#!/bin/sh
set -eu

cd "$(dirname "$0")/../packages/client"

PACKAGE_ID="com.tearleads.rapid"
DEVICE="Maestro_Pixel_6_API_33_1"

pnpm build && pnpm exec cap sync android && pnpm exec cap run android --target "$DEVICE"

# Restart the app to ensure fresh state
adb shell am force-stop "$PACKAGE_ID" 2>/dev/null || true
adb shell am start -n "$PACKAGE_ID/.MainActivity"
