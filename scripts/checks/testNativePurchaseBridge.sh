#!/bin/sh
set -eu

platform=${1:-}
case "$platform" in
  android|ios) ;;
  *) echo "Usage: testNativePurchaseBridge.sh android|ios" >&2; exit 2 ;;
esac

unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
cd "$(CDPATH='' cd -P -- "$(dirname -- "$0")/../.." && pwd -P)"

if [ "$platform" = android ]; then
  bun --bun run turbo run build --filter=app-capacitor^...
  cd packages/app-capacitor
  VITE_API_BASE_URL=https://api-staging.tearleads.com bun run build
  CAPACITOR_BUILD_CONFIGURATION=Release-Staging NATIVE_RELEASE_TIER=staging \
    bunx cap sync android
  cd android
  gradle :app:compileDebugKotlin :app:testDebugUnitTest --no-daemon
  exit 0
fi

# Xcode copies the web bundle into the app as an opaque folder and compiles
# none of it, so a placeholder page keeps this check independent of the web
# build. The Android check syncs the real bundle.
web_dir=$(mktemp -d)
trap 'rm -rf "$web_dir"' EXIT
printf '<!doctype html><title>iOS compile check</title>\n' >"$web_dir/index.html"

cd packages/app-capacitor
CAPACITOR_WEB_DIR=$web_dir CAPACITOR_BUILD_CONFIGURATION=Release-Staging \
  NATIVE_RELEASE_TIER=staging bunx cap sync ios
swift test --package-path ios/App/RevenueCatPurchaseState
swift test --package-path ios/App/PasswordKeychainState
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
