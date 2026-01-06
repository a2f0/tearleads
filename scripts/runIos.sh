#!/bin/sh
set -eu

cd "$(dirname "$0")/../packages/client"

BUNDLE_ID="com.tearleads.rapid"
DEVICE="iPhone 16 Pro"

pnpm build && pnpm exec cap sync ios
xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true
# Note: Don't uninstall - it wipes app data. Use resetIosSimulator.sh for clean slate.
pnpm exec cap run ios --target-name "$DEVICE"
