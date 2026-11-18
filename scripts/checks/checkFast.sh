#!/bin/sh

set -e

unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
REPO_ROOT="$(git -C "$(dirname -- "$0")" rev-parse --show-toplevel)"
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
