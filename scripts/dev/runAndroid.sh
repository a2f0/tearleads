#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
cd "$SCRIPT_DIR/../../packages/app-capacitor" || exit 1

# shellcheck source=scripts/lib/gradleWrapper.sh
. "$SCRIPT_DIR/../lib/gradleWrapper.sh"
ensure_gradle_wrapper_jar android

# shellcheck source=scripts/lib/secretsStore.sh
. "$SCRIPT_DIR/../lib/secretsStore.sh"
secrets_store_link "$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd -P)"

# Vite inlines VITE_* at build time; src/index.tsx throws "VITE_API_BASE_URL is
# not set" on boot when it is missing, leaving a blank WebView. From the Android
# emulator the host machine is 10.0.2.2 (not localhost, which is the emulator
# itself); the local API (scripts/dev/runApi.sh) listens on 3001. Override for a
# physical device (use the host's LAN IP, also allowed in the debug
# android/app/src/debug/res/xml/network_security_config.xml) or a non-default
# API URL/port. Debug builds request Android 17's local network permission.
# Identity commitments require one canonical API URL for clients sharing a DB.
# For web/native together, point the web client's BUN_PUBLIC_API_BASE_URL and
# this build's VITE_API_BASE_URL at the same reachable URL, and set the API's
# API_IDENTITY_TRUST_DOMAIN to it, before creating policies. The default below
# is NOT the web localhost scope;
# see docs/developer/trusted-user-identity.md, Trust Domain Configuration.
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://10.0.2.2:3001}"
echo "Building with VITE_API_BASE_URL=$VITE_API_BASE_URL"

# Store releases get the RevenueCat public SDK key from Fastlane's selectively
# loaded dotenv environment; this script reads production's shared file directly.
# Without it the build inlines no key and billing degrades to the unavailable
# stub — a purchase cannot be exercised on the emulator or a device at all.
# shellcheck source=scripts/lib/exportRevenueCatKeys.sh
. "$SCRIPT_DIR/../lib/exportRevenueCatKeys.sh"
export_revenuecat_keys "$SCRIPT_DIR/../../.secrets/prod/shared.env"
report_revenuecat_key VITE_REVENUECAT_ANDROID_API_KEY

bun run build
bun run cap:sync
bun run cap:run:android
