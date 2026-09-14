#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || "$(uname -sm)" != "Linux x86_64" ]]; then
  echo "Usage: $0 <staging|production> (requires Linux x64)" >&2
  exit 1
fi
export ELECTROBUN_RELEASE_TIER="$1"
case "$1" in
  staging)
    CHANNEL=canary
    export BUN_PUBLIC_API_BASE_URL=https://api-staging.tearleads.com
    export BUN_PUBLIC_WS_URL=wss://api-staging.tearleads.com/events
    ;;
  production)
    CHANNEL=stable
    export BUN_PUBLIC_API_BASE_URL=https://api.tearleads.com
    export BUN_PUBLIC_WS_URL=wss://api.tearleads.com/events
    ;;
  *) echo "Unknown release tier: $1" >&2; exit 1 ;;
esac
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"
bunx turbo run build --filter='app-electrobun^...'
mkdir -p packages/app-electrobun/build/release-icons
rsvg-convert -w 512 -h 512 packages/ui/assets/logo.svg \
  -o packages/app-electrobun/build/release-icons/icon.png
sh packages/app-electrobun/scripts/buildElectrobun.sh --env="$CHANNEL"
bun packages/app-electrobun/scripts/verifyLinuxArtifacts.ts "$1"
