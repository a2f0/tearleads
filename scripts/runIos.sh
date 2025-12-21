#!/bin/sh
set -eu

cd "$(dirname "$0")/../packages/client"

BUNDLE_ID="com.tearleads.rapid"
DEVICE="iPhone 16"

pnpm build && pnpm exec cap sync ios
xcrun simctl terminate booted "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl uninstall booted "$BUNDLE_ID" 2>/dev/null || true
pnpm exec cap run ios --target-name "$DEVICE"
