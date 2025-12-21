#!/bin/sh
set -eu

cd "$(dirname "$0")/../packages/client"

PACKAGE_ID="com.tearleads.rapid"
DEVICE="Maestro_Pixel_6_API_33_1"

pnpm build && pnpm exec cap sync android
adb shell am force-stop "$PACKAGE_ID" 2>/dev/null || true
adb uninstall "$PACKAGE_ID" 2>/dev/null || true
pnpm exec cap run android --target "$DEVICE"
