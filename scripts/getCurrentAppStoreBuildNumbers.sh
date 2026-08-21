#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/getCurrentAppStoreBuildNumbers.sh [production|staging] [fastlane-options...]

Show the current Apple App Store build numbers via the Fastlane
store_build_numbers lane, with the Google Play fetch skipped. Without a tier
argument both apps are queried:
  production  com.symcrypt.app
  staging     com.symcrypt.staging.app

Remaining arguments are passed through to the lane, e.g.
apple_version:<version> to select a specific version.

The lane's apple_live option defaults to false here so the latest uploaded
build is reported even while an app has no live App Store version (the staging
app never does). Pass apple_live:true or export APP_STORE_LIVE=true to query
the live version instead. An APP_STORE_LIVE set only in .secrets/root.env is
loaded by Fastlane after this default is decided, so it must be exported in
the environment to take effect here.

App Store Connect authentication uses APP_STORE_CONNECT_KEY_ID and
APP_STORE_CONNECT_ISSUER_ID, loaded by Fastlane from .secrets/root.env. The
private key defaults to .secrets/AuthKey_<key-id>.p8.

The Fastlane lane reports fetch failures without failing, so this wrapper
exits nonzero when a queried app does not report a build number.
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
  fetch_status=0
  bun run "$fetch_command" skip_google:true "$@" > "$FETCH_LOG" 2>&1 || fetch_status=$?
  cat "$FETCH_LOG"
  if [ "$fetch_status" -ne 0 ]; then
    echo "Error: the $fetch_tier App Store build number fetch failed." >&2
    return "$fetch_status"
  fi
  if ! grep -q "Apple App Store latest build number:" "$FETCH_LOG"; then
    echo "Error: the $fetch_tier fetch did not report an App Store build number." >&2
    return 1
  fi
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

FETCH_LOG="$(mktemp "${TMPDIR:-/tmp}/app-store-build-numbers.XXXXXX")"
trap 'rm -f "$FETCH_LOG"' EXIT

if [ -n "$selected_tier" ]; then
  fetch_tier_build_number "$selected_tier" "$@"
else
  fetch_tier_build_number production "$@"
  fetch_tier_build_number staging "$@"
fi
