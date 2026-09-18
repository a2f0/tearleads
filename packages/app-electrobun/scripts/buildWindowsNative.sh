#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || "$(bun -p 'process.platform + "-" + process.arch')" != win32-x64 ]]; then
  echo "Usage: $0 <staging|production> (requires Windows x64)" >&2
  exit 1
fi
export ELECTROBUN_RELEASE_TIER="$1"
export TEARLEADS_ELECTROBUN_SOURCEMAP_UPLOAD=deferred
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
sh packages/app-electrobun/scripts/buildElectrobun.sh --env="$CHANNEL"
bun packages/app-electrobun/scripts/verifyWindowsArtifacts.ts "$1"
bun packages/app-electrobun/scripts/testWindowsPersistence.ts "$1"
