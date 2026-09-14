#!/bin/sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# shellcheck disable=SC1091
. "$REPO_ROOT/scripts/stepTimings.sh"
# shellcheck disable=SC1091
. "$REPO_ROOT/scripts/checks/fastChecks.sh"

step_timings_reset
run_fast_checks
step_timings_summary
