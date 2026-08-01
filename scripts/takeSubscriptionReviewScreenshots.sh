#!/bin/sh
set -eu

# Build the real Capacitor iOS shell, drive its native subscription surface with
# Maestro, and write App Store review PNGs below the gitignored .screenshots/.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd -P)"
CAPACITOR_DIR="$REPO_ROOT/packages/app-capacitor"
FLOW="$CAPACITOR_DIR/maestro/review/subscription-review-screenshots.yaml"
VERIFY_FLOW="$CAPACITOR_DIR/maestro/review/subscription-review-catalog-visible.yaml"
OUTPUT_DIR="${SUBSCRIPTION_SCREENSHOT_OUTPUT_DIR:-$REPO_ROOT/.screenshots/app-store-review}"
MAESTRO_OUTPUT_DIR="$OUTPUT_DIR/maestro"
BUILD_DIR="${TMPDIR:-/tmp}/tearleads-subscription-review-derived-data"
REVENUECAT_ENV_FILE="${SUBSCRIPTION_SCREENSHOT_REVENUECAT_ENV_FILE:-$REPO_ROOT/.secrets/root.env}"
DEVICE_NAME="Tearleads Subscription Review"
DEVICE_TYPE_IDENTIFIER="com.apple.CoreSimulator.SimDeviceType.iPhone-16"
DEVICE_RUNTIME_VERSION="${IOS_SCREENSHOT_RUNTIME_VERSION:-18.0}"

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

# Store releases load this public SDK key through Fastlane. The review capture
# uses the same selectively loaded value without sourcing unrelated secrets.
# shellcheck source=scripts/exportRevenueCatKeys.sh
. "$REPO_ROOT/scripts/exportRevenueCatKeys.sh"
# shellcheck source=scripts/releaseGuards.sh
. "$REPO_ROOT/scripts/releaseGuards.sh"
export_revenuecat_keys "$REVENUECAT_ENV_FILE"
[ -n "${VITE_REVENUECAT_IOS_API_KEY:-}" ] || {
  echo "VITE_REVENUECAT_IOS_API_KEY is required for native billing screenshots." >&2
  exit 1
}
reject_invalid_revenuecat_store_key \
  VITE_REVENUECAT_IOS_API_KEY \
  "$VITE_REVENUECAT_IOS_API_KEY" \
  appl_

# Match the shipping app end to end: production API, production app id, and the
# production iOS RevenueCat key. Reject stale dev-shell overrides before any
# simulator is created or authenticated.
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.tearleads.com}"
reject_dev_only_url VITE_API_BASE_URL "$VITE_API_BASE_URL"
echo "Using subscription review API: $VITE_API_BASE_URL"

DEVICE_UDID="${IOS_SCREENSHOT_DEVICE_UDID:-}"
runtime_identifier="$(
  xcrun simctl list runtimes available -j |
    jq -r --arg version "$DEVICE_RUNTIME_VERSION" --arg type "$DEVICE_TYPE_IDENTIFIER" \
      '[
        .runtimes[] |
        select(.version == $version and .isAvailable == true) |
        select(any(.supportedDeviceTypes[]?; .identifier == $type))
      ] | first | .identifier // empty'
)"
[ -n "$runtime_identifier" ] || {
  echo "No iOS $DEVICE_RUNTIME_VERSION runtime supporting iPhone 16 is installed." >&2
  exit 1
}
if [ -z "$DEVICE_UDID" ]; then
  DEVICE_UDID="$(
    xcrun simctl list devices available -j |
      jq -r \
        --arg name "$DEVICE_NAME" \
        --arg runtime "$runtime_identifier" \
        --arg type "$DEVICE_TYPE_IDENTIFIER" \
        '[
          .devices[$runtime][]? |
          select(
            .name == $name and
            .deviceTypeIdentifier == $type and
            .isAvailable == true
          )
        ] | first | .udid // empty'
  )"
  if [ -z "$DEVICE_UDID" ]; then
    DEVICE_UDID="$(
      xcrun simctl create \
        "$DEVICE_NAME" \
        "$DEVICE_TYPE_IDENTIFIER" \
        "$runtime_identifier"
    )"
  fi
fi
[ -n "$DEVICE_UDID" ] || {
  echo "Could not create the dedicated subscription review simulator." >&2
  exit 1
}
selected_device="$(
  xcrun simctl list devices available -j |
    jq -r --arg udid "$DEVICE_UDID" --arg runtime "$runtime_identifier" \
      '[
        .devices[$runtime][]? |
        select(.udid == $udid and .isAvailable == true) |
        [.name, .deviceTypeIdentifier] | @tsv
      ] | first // empty'
)"
[ "$selected_device" = "$(printf '%s\t%s' "$DEVICE_NAME" "$DEVICE_TYPE_IDENTIFIER")" ] || {
  echo "The selected simulator must be the dedicated iPhone 16" \
    "'$DEVICE_NAME' on iOS $DEVICE_RUNTIME_VERSION." >&2
  exit 1
}

mkdir -p "$OUTPUT_DIR" "$MAESTRO_OUTPUT_DIR"
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
open -a Simulator --args -CurrentDeviceUDID "$DEVICE_UDID" || true
xcrun simctl bootstatus "$DEVICE_UDID" -b

xcrun simctl terminate "$DEVICE_UDID" com.tearleads.app 2>/dev/null || true
xcrun simctl install \
  "$DEVICE_UDID" \
  "$BUILD_DIR/Build/Products/Debug-iphonesimulator/App.app"

maestro --platform ios --device "$DEVICE_UDID" test \
  --test-output-dir "$MAESTRO_OUTPUT_DIR" \
  "$FLOW"

trap 'xcrun simctl status_bar "$DEVICE_UDID" clear >/dev/null 2>&1 || true' EXIT
xcrun simctl status_bar "$DEVICE_UDID" override \
  --time 9:41 \
  --batteryState charged \
  --batteryLevel 100 \
  --wifiBars 3 \
  --cellularBars 4
# SpringBoard applies the override asynchronously; wait for a complete, stable
# status bar before taking review evidence.
sleep 2

solo_path="$OUTPUT_DIR/subscription-solo.png"
# Maestro verifies and positions the real native catalog. simctl produces
# Apple's exact 1179x2556 size; the black mask also removes the rejected alpha
# channel. All three App Store records use this same catalog evidence.
xcrun simctl io "$DEVICE_UDID" screenshot \
  --type=png \
  --mask=black \
  "$solo_path" >/dev/null

# Confirm the app is still presenting the verified catalog after the native
# framebuffer capture. A system alert or backgrounded app fails the run instead
# of silently leaving a wrong-but-correctly-sized review image behind.
maestro --platform ios --device "$DEVICE_UDID" test \
  --test-output-dir "$MAESTRO_OUTPUT_DIR" \
  "$VERIFY_FLOW"

cp "$solo_path" "$OUTPUT_DIR/subscription-team-5.png"
cp "$solo_path" "$OUTPUT_DIR/subscription-team-10.png"

for screenshot in \
  subscription-solo.png \
  subscription-team-5.png \
  subscription-team-10.png; do
  path="$OUTPUT_DIR/$screenshot"
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
