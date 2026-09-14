#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
TIER="${2:-}"
case "$ACTION:$TIER:$#" in
  build:staging:2 | build:production:2 | upload:staging:2 | upload:production:2) ;;
  *) echo "Usage: $0 <build|upload> <staging|production>" >&2; exit 1 ;;
esac
REPO_ROOT="$(git rev-parse --show-toplevel)"
PACKAGE_DIR="$REPO_ROOT/packages/app-electrobun"
# shellcheck source=terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"
TF_TIER="$TIER"
[[ "$TIER" != production ]] || TF_TIER=prod
load_secrets_env "$TF_TIER"
if [[ "$ACTION" == upload ]]; then validate_aws_env; fi
if [[ "$TIER" == staging ]]; then
  CHANNEL=canary
  BUCKET=downloads-staging.tearleads.com
  APP_NAME=Tearleads-canary
  INSTALLER=canary-linux-x64-Tearleads-canary-Setup.tar.gz
else
  CHANNEL=stable
  BUCKET=downloads.tearleads.com
  APP_NAME=Tearleads
  INSTALLER=linux-x64-Tearleads-Setup.tar.gz
fi
docker info >/dev/null
TEMP_DIR="$(mktemp -d)"
CONTAINER=""
cleanup() {
  if [[ -n "$CONTAINER" ]]; then docker rm "$CONTAINER" >/dev/null; fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT
trap 'exit 1' INT TERM
cd "$REPO_ROOT"
# Only tracked working files enter Docker. Stage new source files before building;
# ignored output, host dependencies, .git, and .secrets never enter the context.
git ls-files -z | COPYFILE_DISABLE=1 tar --null -T - -czf "$TEMP_DIR/source.tar.gz"
export BUILD_GIT_SHA
BUILD_GIT_SHA="$(git rev-parse HEAD)"
docker build --platform linux/amd64 --progress plain \
  --file packages/app-electrobun/scripts/linuxRelease.Dockerfile \
  --tag "tearleads-linux-release:$TIER" --iidfile "$TEMP_DIR/image-id" \
  --build-arg "RELEASE_TIER=$TIER" --build-arg BUILD_GIT_SHA \
  --build-arg SENTRY_ELECTROBUN_PRODUCTION_DSN \
  --build-arg SENTRY_ELECTROBUN_STAGING_DSN - < "$TEMP_DIR/source.tar.gz"
CONTAINER="$(docker create --platform linux/amd64 "$(cat "$TEMP_DIR/image-id")")"
docker cp "$CONTAINER:/workspace/packages/app-electrobun/build/artifacts/." "$TEMP_DIR/artifacts"
ARTIFACT_DIR="$PACKAGE_DIR/build/linux-x64/$TIER"
UPDATE="$CHANNEL-linux-x64-update.json"
ARCHIVE="$CHANNEL-linux-x64-$APP_NAME.tar.zst"
for artifact in "$INSTALLER" "$UPDATE" "$ARCHIVE"; do
  if [[ ! -s "$TEMP_DIR/artifacts/$artifact" ]]; then
    echo "Missing Linux release artifact: $artifact" >&2
    exit 1
  fi
done
mkdir -p "$ARTIFACT_DIR"
cp "$TEMP_DIR/artifacts/$INSTALLER" "$TEMP_DIR/artifacts/$UPDATE" \
  "$TEMP_DIR/artifacts/$ARCHIVE" "$ARTIFACT_DIR/"
(cd "$ARTIFACT_DIR" && shasum -a 256 "$INSTALLER" > "$INSTALLER.sha256")
echo "Built $TIER Linux x64 release: $ARTIFACT_DIR/$INSTALLER"
if [[ "$ACTION" == build ]]; then exit 0; fi
docker run --rm --platform linux/amd64 --shm-size=1g --user 1000:1000 \
  "$(cat "$TEMP_DIR/image-id")" \
  bash packages/app-electrobun/scripts/testLinuxRelease.sh "$TIER"
bun "$PACKAGE_DIR/scripts/publishLinuxRelease.ts" "$BUCKET" "$CHANNEL" \
  "$APP_NAME" "$ARTIFACT_DIR/$INSTALLER" "$ARTIFACT_DIR/$UPDATE" "$ARTIFACT_DIR/$ARCHIVE"
