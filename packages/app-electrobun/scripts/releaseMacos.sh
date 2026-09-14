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

REPO_ROOT="$(git rev-parse --show-toplevel)"
PACKAGE_DIR="$REPO_ROOT/packages/app-electrobun"
# shellcheck source=terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"
TF_TIER="$TIER"
[[ "$TIER" != production ]] || TF_TIER=prod
load_secrets_env "$TF_TIER"
# shellcheck source=packages/app-electrobun/scripts/macosSigning.sh
source "$PACKAGE_DIR/scripts/macosSigning.sh"
configure_macos_signing
if [[ "$ACTION" == upload ]]; then validate_aws_env; fi

export ELECTROBUN_RELEASE_TIER="$TIER"
if [[ "$TIER" == staging ]]; then
  CHANNEL=canary
  BUCKET=downloads-staging.tearleads.com
  APP_NAME=Tearleads-canary
  INSTALLER=canary-macos-arm64-Tearleads-canary.dmg
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

cd "$REPO_ROOT"
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

# Publish payloads before update metadata. Never sync --delete across channels.
for artifact in "$DMG" "$DMG.sha256" "$ARCHIVE"; do
  content_type=application/octet-stream
  [[ "$artifact" != *.sha256 ]] || content_type=text/plain
  aws s3 cp "$artifact" "s3://$BUCKET/$(basename "$artifact")" \
    --region us-east-1 --only-show-errors --content-type "$content_type" \
    --cache-control 'public, max-age=0, must-revalidate'
done
aws s3 cp "$UPDATE" "s3://$BUCKET/$(basename "$UPDATE")" \
  --region us-east-1 --only-show-errors --content-type application/json \
  --cache-control 'public, max-age=0, must-revalidate'
echo "Download: https://s3.us-east-1.amazonaws.com/$BUCKET/$INSTALLER"
