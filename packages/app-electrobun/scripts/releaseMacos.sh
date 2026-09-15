#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
TIER="${2:-}"
case "$ACTION:$TIER" in
  build:staging | build:production | upload:staging | upload:production) ;;
  *) echo "Usage: $0 <build|upload> <staging|production>" >&2; exit 1 ;;
esac
if [[ $# -ne 2 || "$(uname -sm)" != "Darwin arm64" ]]; then
  echo "macOS releases require an Apple silicon Mac and exactly one release tier." >&2
  exit 1
fi

# GIT_* variables could point Git, and every child, at another checkout, index
# or object store. The release acts only on the checkout holding this script
# (links resolved), which must be the top level of its own Git work tree.
for name in "${!GIT_@}"; do unset "$name"; done
script="${BASH_SOURCE[0]}"
while [[ -L "$script" ]]; do
  link="$(readlink -- "$script")"
  [[ "$link" == /* ]] || link="$(dirname -- "$script")/$link"
  script="$link"
done
REPO_ROOT="$(CDPATH='' cd -P -- "$(dirname -- "$script")/../../.." && pwd -P)"
toplevel="$(git -C "$REPO_ROOT" rev-parse --show-toplevel)" || toplevel=""
if [[ "$toplevel" != "$REPO_ROOT" ]]; then
  echo "macOS releases must run from the top level of their own Git checkout." >&2
  exit 1
fi
cd "$REPO_ROOT"
PACKAGE_DIR="$REPO_ROOT/packages/app-electrobun"
# Bun loads a bunfig.toml and dotenv files from its working directory, and turbo
# starts Bun in each package before the Sentry wrapper checks the checkout, so
# an untracked or modified file refuses the release before any Bun process runs.
# Host ignore rules must not hide Bun configuration, and status must not run a
# configured filesystem-monitor hook before the checkout has been validated.
changes="$(git -c core.excludesFile=/dev/null -c core.fsmonitor=false status --porcelain=v1 --untracked-files=normal)"
if [[ -n "$changes" ]]; then
  echo "macOS releases require a clean Git checkout; commit changes first." >&2
  exit 1
fi
# shellcheck source=terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"
TF_TIER="$TIER"
[[ "$TIER" != production ]] || TF_TIER=prod
load_secrets_env "$TF_TIER"
# load_secrets_env exports every root.env name. Only the Sentry wrapper needs
# the upload token, and it reads the file itself.
unset SENTRY_AUTH_TOKEN
# These add env files, preload modules or a debugger to every Bun process.
unset BUN_OPTIONS BUN_INSPECT BUN_INSPECT_CONNECT_TO BUN_INSPECT_NOTIFY \
  BUN_INSPECT_PRELOAD
# shellcheck source=packages/app-electrobun/scripts/macosSigning.sh
source "$PACKAGE_DIR/scripts/macosSigning.sh"
configure_macos_signing
if [[ "$ACTION" == upload ]]; then validate_aws_env; fi

export ELECTROBUN_RELEASE_TIER="$TIER"
if [[ "$TIER" == staging ]]; then
  CHANNEL=canary
  BUCKET=downloads-staging.tearleads.com
  APP_NAME=TLStaging-canary
  INSTALLER=canary-macos-arm64-TLStaging-canary.dmg
  export BUN_PUBLIC_API_BASE_URL=https://api-staging.tearleads.com
  export BUN_PUBLIC_WS_URL=wss://api-staging.tearleads.com/events
else
  CHANNEL=stable
  BUCKET=downloads.tearleads.com
  APP_NAME=Tearleads
  INSTALLER=macos-arm64-Tearleads.dmg
  export BUN_PUBLIC_API_BASE_URL=https://api.tearleads.com
  export BUN_PUBLIC_WS_URL=wss://api.tearleads.com/events
fi

bunx turbo run build --filter='app-electrobun^...'
bash "$PACKAGE_DIR/scripts/buildMacosIcon.sh"
sh "$PACKAGE_DIR/scripts/buildElectrobun.sh" --env="$CHANNEL"
ARTIFACT_DIR="$PACKAGE_DIR/build/artifacts"
DMG="$ARTIFACT_DIR/$INSTALLER"
UPDATE="$ARTIFACT_DIR/$CHANNEL-macos-arm64-update.json"
ARCHIVE="$ARTIFACT_DIR/$CHANNEL-macos-arm64-$APP_NAME.app.tar.zst"
for artifact in "$DMG" "$UPDATE" "$ARCHIVE"; do
  if [[ ! -s "$artifact" ]]; then echo "Missing release artifact: $artifact" >&2; exit 1; fi
done
xcrun stapler validate "$DMG"
shasum -a 256 "$DMG" | sed "s|$ARTIFACT_DIR/||" > "$DMG.sha256"
echo "Built $TIER macOS release: $DMG"
if [[ "$ACTION" == build ]]; then exit 0; fi

bun "$PACKAGE_DIR/scripts/publishMacosRelease.ts" \
  "$BUCKET" "$CHANNEL" "$APP_NAME" "$DMG" "$UPDATE" "$ARCHIVE"
