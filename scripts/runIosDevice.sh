#!/bin/sh
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
PM_SCRIPT="$SCRIPT_DIR/tooling/pm.sh"

REPO_ROOT="$SCRIPT_DIR/.."
SECRETS_ENV="$REPO_ROOT/.secrets/root.env"

# Load TEAM_ID from .secrets/root.env if not already set
if [ -z "${TEAM_ID:-}" ] && [ -f "$SECRETS_ENV" ]; then
  TEAM_ID=$(sed -nE '/^(export )?TEAM_ID=/ { s/^(export )?TEAM_ID=//; s/^['"'"'"]+//; s/['"'"'"]+$//; p; q; }' "$SECRETS_ENV")
fi

cd "$REPO_ROOT/packages/client"

BUNDLE_ID="com.tearleads.app"
WORKSPACE="ios/App/App.xcworkspace"
SCHEME="App"
DERIVED_DATA="ios/DerivedData"

# Auto-detect a connected device, or accept a devicectl identifier as an argument
if [ -n "${1:-}" ]; then
  DEVICE_ID="$1"
else
  DEVICE_LINE=$(xcrun devicectl list devices 2>/dev/null \
    | grep -E 'available.*(iPhone|iPad)' \
    | head -1)
  if [ -z "$DEVICE_LINE" ]; then
    echo "Error: No connected iOS device found. Plug in a device or pass a device identifier as an argument." >&2
    echo "Run 'xcrun devicectl list devices' to see available devices." >&2
    exit 1
  fi
  DEVICE_ID=$(echo "$DEVICE_LINE" | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}')
  DEVICE_NAME=$(echo "$DEVICE_LINE" | sed -E "s/\s\s+${DEVICE_ID}.*//")
  echo "Detected device: $DEVICE_NAME ($DEVICE_ID)"
fi

export VITE_API_URL="${VITE_API_URL:-http://localhost:3000/v1}"

# Build web assets and sync to native project
sh "$PM_SCRIPT" run build && sh "$PM_SCRIPT" exec cap sync ios

# Build for physical device with automatic development signing
echo "Building for device..."
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$DERIVED_DATA" \
  -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic \
  CODE_SIGN_IDENTITY="Apple Development" \
  DEVELOPMENT_TEAM="${TEAM_ID:?TEAM_ID not set. Add it to .secrets/root.env or export it.}" \
  build

# Find the built .app bundle
APP_PATH=$(find "$DERIVED_DATA/Build/Products/Debug-iphoneos" -name "*.app" -maxdepth 1 -type d)
if [ -z "$APP_PATH" ]; then
  echo "Error: Could not find built .app bundle in $DERIVED_DATA" >&2
  exit 1
fi

# Install and launch on device
echo "Installing on device..."
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"

echo "Launching app..."
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID"
