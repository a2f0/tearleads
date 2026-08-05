#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/getCurrentAppStoreBuildNumbers.sh [production|staging] [fastlane-options...]

Show the current Apple App Store build numbers via the Fastlane
store_build_numbers lane, with the Google Play fetch skipped. Without a tier
argument both apps are queried:
  production  com.tearleads.app
  staging     com.tearleads.staging.app

Remaining arguments are passed through to the lane, e.g.
apple_version:<version> to select a specific version.

The lane's apple_live option defaults to false here so the latest uploaded
build is reported even while an app has no live App Store version (the staging
app never does). Pass apple_live:true or set APP_STORE_LIVE to query the live
version instead.

App Store Connect authentication uses APP_STORE_CONNECT_KEY_ID,
APP_STORE_CONNECT_ISSUER_ID, and TEAM_ID, loaded by Fastlane from
.secrets/root.env. The private key defaults to .secrets/AuthKey_<key-id>.p8.
EOF
}

apple_live_chosen() {
  [ -z "${APP_STORE_LIVE:-}" ] || return 0
  for apple_live_arg in "$@"; do
    case "$apple_live_arg" in
      apple_live:*) return 0 ;;
    esac
  done
  return 1
}

fetch_tier_build_number() {
  fetch_tier="$1"
  shift
  fetch_command="store:build-numbers"
  [ "$fetch_tier" = production ] || fetch_command="store:build-numbers:$fetch_tier"
  if ! apple_live_chosen "$@"; then
    set -- "$@" apple_live:false
  fi

  echo "Fetching current App Store build number for $fetch_tier..."
  bun run "$fetch_command" skip_google:true "$@"
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

selected_tier=""
case "${1:-}" in
  production | staging)
    selected_tier="$1"
    shift
    ;;
esac

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
cd "$SCRIPT_DIR/../packages/app-capacitor"

if [ -n "$selected_tier" ]; then
  fetch_tier_build_number "$selected_tier" "$@"
else
  fetch_tier_build_number production "$@"
  fetch_tier_build_number staging "$@"
fi
