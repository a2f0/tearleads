#!/bin/sh
set -eu

# Build the real Capacitor iOS shell, drive its native subscription surface with
# Maestro, and write App Store review PNGs below the gitignored .screenshots/.

REPO_ROOT="$(git rev-parse --show-toplevel)"
CAPACITOR_DIR="$REPO_ROOT/packages/app-capacitor"
FLOW="$CAPACITOR_DIR/maestro/subscription-review-screenshots.yaml"
OUTPUT_DIR="${SUBSCRIPTION_SCREENSHOT_OUTPUT_DIR:-$REPO_ROOT/.screenshots/app-store-review}"
BUILD_DIR="$CAPACITOR_DIR/build/subscription-review"
DEVICE_NAME="${IOS_SCREENSHOT_DEVICE_NAME:-iPhone 16}"

command -v maestro >/dev/null 2>&1 || {
  echo "Maestro is required: https://maestro.mobile.dev" >&2
  exit 1
}
command -v xcrun >/dev/null 2>&1 || {
  echo "Xcode command-line tools are required." >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "jq is required to select an iOS simulator." >&2
  exit 1
}
command -v sips >/dev/null 2>&1 || {
  echo "sips is required to validate the generated PNGs." >&2
  exit 1
}

DEVICE_UDID="${IOS_SCREENSHOT_DEVICE_UDID:-}"
if [ -z "$DEVICE_UDID" ]; then
  DEVICE_UDID="$(
    xcrun simctl list devices available -j |
      jq -r --arg name "$DEVICE_NAME" \
        '[.devices[][] | select(.name == $name and .isAvailable == true)] | last | .udid // empty'
  )"
fi
[ -n "$DEVICE_UDID" ] || {
  echo "No available iOS simulator named '$DEVICE_NAME'." >&2
  exit 1
}

# Store releases load this public SDK key through Fastlane. The review capture
# uses the same selectively loaded value without sourcing unrelated secrets.
# shellcheck source=scripts/exportRevenueCatKeys.sh
. "$REPO_ROOT/scripts/exportRevenueCatKeys.sh"
export_revenuecat_keys "$REPO_ROOT/.secrets/root.env"
[ -n "${VITE_REVENUECAT_IOS_API_KEY:-}" ] || {
  echo "VITE_REVENUECAT_IOS_API_KEY is required for native billing screenshots." >&2
  exit 1
}

# The staging API keeps the persistent screenshot identity and organization out
# of production. The production app id and iOS RevenueCat key still exercise the
# exact native catalog displayed by the shipping app.
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.tearleads.de}"

mkdir -p "$OUTPUT_DIR"
for screenshot in \
  subscription-solo.png \
  subscription-team-5.png \
  subscription-team-10.png; do
  rm -f "$OUTPUT_DIR/$screenshot"
done

echo "Building the Capacitor app for $DEVICE_NAME ($DEVICE_UDID)..."
(
  cd "$CAPACITOR_DIR"
  bun run build
  NATIVE_RELEASE_TIER=production \
    CAPACITOR_BUILD_CONFIGURATION=Debug \
    bunx cap sync ios
  xcodebuild \
    -quiet \
    -project ios/App/App.xcodeproj \
    -scheme App \
    -configuration Debug \
    -sdk iphonesimulator \
    -derivedDataPath "$BUILD_DIR" \
    -destination "id=$DEVICE_UDID" \
    CODE_SIGNING_ALLOWED=NO \
    build
)

xcrun simctl boot "$DEVICE_UDID" 2>/dev/null || true
open -a Simulator --args -CurrentDeviceUDID "$DEVICE_UDID"
xcrun simctl bootstatus "$DEVICE_UDID" -b

xcrun simctl terminate "$DEVICE_UDID" com.tearleads.app 2>/dev/null || true
xcrun simctl install \
  "$DEVICE_UDID" \
  "$BUILD_DIR/Build/Products/Debug-iphonesimulator/App.app"

maestro --platform ios --device "$DEVICE_UDID" test \
  --test-output-dir "$OUTPUT_DIR" \
  "$FLOW"

xcrun simctl status_bar "$DEVICE_UDID" override \
  --time 9:41 \
  --batteryState charged \
  --batteryLevel 100 \
  --wifiBars 3 \
  --cellularBars 4
trap 'xcrun simctl status_bar "$DEVICE_UDID" clear >/dev/null 2>&1 || true' EXIT
# SpringBoard applies the override asynchronously; wait for a complete, stable
# status bar before taking review evidence.
sleep 2

for screenshot in \
  subscription-solo.png \
  subscription-team-5.png \
  subscription-team-10.png; do
  path="$OUTPUT_DIR/$screenshot"
  # Maestro verifies and positions the real native catalog, but its iOS PNG is
  # one pixel narrower than the simulator framebuffer. simctl produces Apple's
  # exact 1179x2556 size; the black mask also removes the rejected alpha channel.
  xcrun simctl io "$DEVICE_UDID" screenshot \
    --type=png \
    --mask=black \
    "$path" >/dev/null
  [ -s "$path" ] || {
    echo "simctl did not create $path." >&2
    exit 1
  }
  dimensions="$(
    sips -g pixelWidth -g pixelHeight "$path" 2>/dev/null |
      awk '/pixelWidth:/ { width=$2 } /pixelHeight:/ { height=$2 } END { print width "x" height }'
  )"
  [ "$dimensions" = "1179x2556" ] || {
    echo "$path is $dimensions; expected iPhone 16 portrait 1179x2556." >&2
    exit 1
  }
  has_alpha="$(
    sips -g hasAlpha "$path" 2>/dev/null |
      awk '/hasAlpha:/ { print $2 }'
  )"
  [ "$has_alpha" = "no" ] || {
    echo "$path has an alpha channel; App Store review screenshots cannot." >&2
    exit 1
  }
  echo "Captured $path ($dimensions)."
done
