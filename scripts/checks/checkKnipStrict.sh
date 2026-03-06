#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd)
PM_SCRIPT="$REPO_ROOT/scripts/tooling/pm.sh"
cd "$REPO_ROOT"

MODE="${1:-}"
KNIP_OUTPUT_FILE=$(mktemp "${TMPDIR:-/tmp}/knip-strict.XXXXXX")

cleanup() {
  rm -f "$KNIP_OUTPUT_FILE"
}

trap cleanup EXIT HUP INT TERM

set +e
sh "$PM_SCRIPT" exec knip --config knip.ts --strict --tsConfig tsconfig.json --include dependencies,unlisted,unresolved,binaries,catalog --exclude files,exports,nsExports,types,nsTypes,classMembers,enumMembers,duplicates --reporter json >"$KNIP_OUTPUT_FILE"
KNIP_EXIT_CODE=$?
set -e

if [ "$MODE" = "--json" ]; then
  set +e
  sh "$PM_SCRIPT" exec tsx scripts/checks/knipStrictSummary.ts --json <"$KNIP_OUTPUT_FILE"
  SUMMARY_EXIT_CODE=$?
  set -e
else
  set +e
  sh "$PM_SCRIPT" exec tsx scripts/checks/knipStrictSummary.ts <"$KNIP_OUTPUT_FILE"
  SUMMARY_EXIT_CODE=$?
  set -e
fi

if [ "$SUMMARY_EXIT_CODE" -ne 0 ]; then
  exit "$SUMMARY_EXIT_CODE"
fi

if [ "$KNIP_EXIT_CODE" -ne 0 ]; then
  exit "$KNIP_EXIT_CODE"
fi
