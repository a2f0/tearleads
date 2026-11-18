#!/bin/sh
set -eu

platform=${1:-}
case "$platform" in
  android|ios) ;;
  *) echo "Usage: testNativePurchaseBridge.sh android|ios" >&2; exit 2 ;;
esac

unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
cd "$(CDPATH='' cd -P -- "$(dirname -- "$0")/../.." && pwd -P)"
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
