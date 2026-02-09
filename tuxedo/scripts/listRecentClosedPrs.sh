#!/bin/sh
set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

. "$SCRIPT_DIR/../lib/pr-dashboard-lib.sh"

pr_dashboard_main "listRecentClosedPrs.sh" "Recent Closed PRs" "is:pr is:closed sort:created-desc" "$@"
