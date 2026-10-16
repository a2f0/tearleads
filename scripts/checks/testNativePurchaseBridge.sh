#!/bin/sh
set -eu

platform=${1:-}
case "$platform" in
  android|ios) ;;
  *) echo "Usage: testNativePurchaseBridge.sh android|ios" >&2; exit 2 ;;
esac

cd "$(git rev-parse --show-toplevel)"
bun --bun run turbo run build --filter=app-capacitor^...
cd packages/app-capacitor
VITE_API_BASE_URL=https://api-staging.tearleads.com bun run build
CAPACITOR_BUILD_CONFIGURATION=Release-Staging NATIVE_RELEASE_TIER=staging \
  bunx cap sync "$platform"

if [ "$platform" = android ]; then
  cd android
  gradle :app:compileDebugKotlin :app:testDebugUnitTest --no-daemon
else
  swift test --package-path ios/App/RevenueCatPurchaseState
  xcodebuild \
    -quiet \
    -project ios/App/App.xcodeproj \
    -scheme App-Staging \
    -configuration Release-Staging \
    -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -disableAutomaticPackageResolution \
    CODE_SIGNING_ALLOWED=NO \
    build
fi
