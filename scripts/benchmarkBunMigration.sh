#!/usr/bin/env sh
# Compare representative test runs across:
# - pnpm + vitest
# - bunx + vitest
# - bun test (Node-only smoke)
#
# Usage:
#   ./scripts/benchmarkBunMigration.sh
#   BENCH_REPEATS=3 ./scripts/benchmarkBunMigration.sh
set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd -P)

REPEATS="${BENCH_REPEATS:-1}"

if [ "$REPEATS" -lt 1 ] 2>/dev/null; then
  echo "BENCH_REPEATS must be an integer >= 1" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "benchmarkBunMigration: pnpm is required for baseline runs." >&2
  exit 1
fi

if ! command -v mise >/dev/null 2>&1; then
  echo "benchmarkBunMigration: mise is required to run Bun benchmarks." >&2
  exit 1
fi

cd "$REPO_ROOT"

run_timed() {
  label="$1"
  shift
  echo "==> $label"
  echo "    command: $*"

  i=1
  while [ "$i" -le "$REPEATS" ]; do
    echo "    run $i/$REPEATS"
    set +e
    /usr/bin/time -p "$@"
    status=$?
    set -e
    echo "    exit_code=$status"
    i=$((i + 1))
  done
}

echo "Bun migration benchmark"
echo "repo: $REPO_ROOT"
echo "repeats: $REPEATS"
echo

run_timed \
  "pnpm + vitest (node-only sample)" \
  pnpm exec vitest run packages/app-builder/src/generators/theme.test.ts

run_timed \
  "pnpm + vitest (ui/jsdom sample)" \
  pnpm exec vitest run packages/ui/src/context/useTheme.test.tsx

run_timed \
  "pnpm + vitest (api/mock-heavy sample)" \
  pnpm exec vitest run packages/app-mls-chat/src/hooks/useMlsRealtime.test.tsx

run_timed \
  "bunx + vitest (node-only sample)" \
  mise x bun -- bunx vitest run packages/app-builder/src/generators/theme.test.ts

run_timed \
  "bunx + vitest (ui/jsdom sample)" \
  mise x bun -- bunx vitest run packages/ui/src/context/useTheme.test.tsx

run_timed \
  "bunx + vitest (api/mock-heavy sample)" \
  mise x bun -- bunx vitest run packages/app-mls-chat/src/hooks/useMlsRealtime.test.tsx

run_timed \
  "bun test (node-only sample)" \
  mise x bun -- bun test packages/app-builder/src/generators/theme.test.ts

echo
echo "Note:"
echo "- bun test currently fails on many Vitest-specific suites in this repo."
echo "- Use this script for trend data while migrating package-by-package."
