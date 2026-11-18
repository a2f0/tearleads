#!/bin/sh

set -e

for name in $(git rev-parse --local-env-vars); do unset "$name"; done
REPO_ROOT="$(CDPATH='' cd -P -- "$(dirname -- "$0")/../.." && pwd -P)"
cd "$REPO_ROOT"
git_root=$(git rev-parse --show-toplevel)
if [ "$(CDPATH='' cd -P -- "$git_root" && pwd -P)" != "$REPO_ROOT" ]; then
  echo "This command requires its own Git checkout: $REPO_ROOT" >&2
  exit 1
fi

# shellcheck disable=SC1091
. "$REPO_ROOT/scripts/lib/stepTimings.sh"
# shellcheck disable=SC1091
. "$REPO_ROOT/scripts/checks/fastChecks.sh"

step_timings_reset
# CI runs the two pure TLC passes in a job of their own.
if [ "${CI_DEFER_PROTOCOL_MODELS:-}" = "1" ]; then
  defer_model_checks
fi
run_fast_checks
step_timings_summary
