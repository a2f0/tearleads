#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
PACKAGE_DIR="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "$PACKAGE_DIR/../.." && pwd)"

cd "$PACKAGE_DIR"
# ELECTROBUN_RELEASE_TIER (staging|production) selects the desktop Sentry DSN;
# unset builds stay local. The postBuild hook inherits these same defines and
# packages renderer assets before signing and installer creation. The wrapper
# holds the upload token, so it starts without Bun's dotenv loading and without
# BUN_OPTIONS, which could add env files or preload code.
NODE_ENV=production exec sh "$REPO_ROOT/scripts/withBuildInfoEnv.sh" \
  env -u BUN_OPTIONS bun --no-env-file scripts/withSentryReleaseEnv.ts \
  bun --bun run electrobun build "$@"
