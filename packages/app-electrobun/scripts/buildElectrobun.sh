#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
PACKAGE_DIR="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "$PACKAGE_DIR/../.." && pwd)"

cd "$PACKAGE_DIR"
# ELECTROBUN_RELEASE_TIER (staging|production) selects the desktop Sentry DSN;
# unset builds stay local. The postBuild hook inherits these same defines and
# packages renderer assets before signing and installer creation. The wrapper
# holds the upload token, so Bun must not run anything before it: it starts
# without dotenv files, without a working-directory bunfig.toml preload, and
# without BUN_OPTIONS or the BUN_INSPECT* variables, which add env files, preload
# modules or attach a debugger. The wrapper refuses those variables too, but a
# preload would already have run by then.
NODE_ENV=production exec sh "$REPO_ROOT/scripts/withBuildInfoEnv.sh" \
  env -u BUN_OPTIONS -u BUN_INSPECT -u BUN_INSPECT_CONNECT_TO \
  -u BUN_INSPECT_NOTIFY -u BUN_INSPECT_PRELOAD \
  bun --no-env-file --config=/dev/null scripts/withSentryReleaseEnv.ts \
  bun --bun run electrobun build "$@"
