#!/bin/sh

set -e

unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
REPO_ROOT="$(CDPATH='' cd -P -- "$(dirname -- "$0")/../.." && pwd -P)"
cd "$REPO_ROOT"

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
