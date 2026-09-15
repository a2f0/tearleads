#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
PACKAGE_DIR="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "$PACKAGE_DIR/../.." && pwd)"

cd "$PACKAGE_DIR"
# GIT_* variables could point the build identity's Git call, and every child, at
# another checkout; the Sentry wrapper checks this one.
for name in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$name"; done
# ELECTROBUN_RELEASE_TIER (staging|production) selects the desktop Sentry DSN;
# unset builds stay local. The postBuild hook inherits these same defines and
# packages renderer assets before signing and installer creation.
#
# The Sentry wrapper holds the upload token and checks for a clean checkout.
# BUN_OPTIONS and the BUN_INSPECT* variables add env files, preload modules or a
# debugger to every Bun process, so they are unset before the first one, the
# version read in withBuildInfoEnv.sh. Bun processes before the wrapper's check,
# the wrapper included, start without dotenv files or a working-directory
# bunfig.toml. The wrapper refuses those variables too, but a preload would
# already have run by then.
unset BUN_OPTIONS BUN_INSPECT BUN_INSPECT_CONNECT_TO BUN_INSPECT_NOTIFY \
  BUN_INSPECT_PRELOAD
NODE_ENV=production exec sh "$REPO_ROOT/scripts/lib/withBuildInfoEnv.sh" \
  bun --no-env-file --config=/dev/null scripts/withSentryReleaseEnv.ts \
  bun --bun run electrobun build "$@"
