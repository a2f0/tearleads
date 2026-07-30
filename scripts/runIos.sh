#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
cd "$SCRIPT_DIR/../packages/app-capacitor" || exit 1

# Vite inlines VITE_* at build time; src/index.tsx throws "VITE_API_BASE_URL is
# not set" on boot when it is missing, leaving a blank WebView. The iOS
# simulator shares the host network, so the local API (scripts/runApi.sh, port
# 3001) is reachable at localhost. Override for a physical device (use the
# host's LAN IP) or a non-default API URL/port.
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://localhost:3001}"
echo "Building with VITE_API_BASE_URL=$VITE_API_BASE_URL"

# Store releases get the RevenueCat public SDK key from Fastlane's selectively
# loaded dotenv environment; this script reads the same file directly.
# Without it the build inlines no key and billing degrades to the unavailable
# stub — a purchase cannot be exercised on the simulator or a device at all.
# shellcheck source=scripts/exportRevenueCatKeys.sh
. "$SCRIPT_DIR/exportRevenueCatKeys.sh"
export_revenuecat_keys "$SCRIPT_DIR/../.secrets/root.env"
report_revenuecat_key VITE_REVENUECAT_IOS_API_KEY

bun run build
bun run cap:sync
exec bun run cap:run:ios
