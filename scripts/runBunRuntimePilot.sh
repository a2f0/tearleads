#!/usr/bin/env sh
# Run Bun runtime + Vitest pilot suites with pnpm baseline comparison.
#
# Usage:
#   ./scripts/runBunRuntimePilot.sh                # all suites
#   ./scripts/runBunRuntimePilot.sh node           # single suite
#   BENCH_REPEATS=3 ./scripts/runBunRuntimePilot.sh ui
set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd -P)

REPEATS="${BENCH_REPEATS:-1}"
SUITE="${1:-all}"

if [ "$REPEATS" -lt 1 ] 2>/dev/null; then
  echo "BENCH_REPEATS must be an integer >= 1" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "runBunRuntimePilot: pnpm is required for baseline runs." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1 && ! command -v mise >/dev/null 2>&1; then
  echo "runBunRuntimePilot: bun (or mise with bun configured) is required." >&2
  exit 1
fi

if command -v bun >/dev/null 2>&1; then
  BUN_VERSION=$(bun --version 2>/dev/null || echo "unknown")
else
  BUN_VERSION=$(mise x bun -- bun --version 2>/dev/null || echo "unknown")
fi

get_suite_path() {
  case "$1" in
    node) printf '%s\n' "packages/app-builder/src/generators/theme.test.ts" ;;
    ui) printf '%s\n' "packages/ui/src/context/useTheme.test.tsx" ;;
    api) printf '%s\n' "packages/mls-chat/src/hooks/useMlsRealtime.test.tsx" ;;
    *)
      echo "Unknown suite '$1' (expected: node, ui, api)" >&2
      return 1
      ;;
  esac
}

run_bunx_vitest() {
  test_path="$1"
  # Prefer native bunx when available; fall back to mise-managed Bun for local setups.
  if command -v bunx >/dev/null 2>&1; then
    bunx vitest run "$test_path"
    return
  fi

  if command -v bun >/dev/null 2>&1; then
    bun x vitest run "$test_path"
    return
  fi

  mise x bun -- bunx vitest run "$test_path"
}

LAST_AVG_MILLISECONDS=0

run_with_average_milliseconds() {
  label="$1"
  shift

  run_index=1
  total_milliseconds=0
  while [ "$run_index" -le "$REPEATS" ]; do
    echo "==> $label (run $run_index/$REPEATS)"
    echo "    command: $*"
    start_milliseconds=$(node -e 'process.stdout.write(String(Date.now()))')
    "$@"
    end_milliseconds=$(node -e 'process.stdout.write(String(Date.now()))')
    elapsed_milliseconds=$((end_milliseconds - start_milliseconds))
    total_milliseconds=$((total_milliseconds + elapsed_milliseconds))
    echo "    elapsed_ms=$elapsed_milliseconds"
    run_index=$((run_index + 1))
  done

  LAST_AVG_MILLISECONDS=$((total_milliseconds / REPEATS))
}

print_row() {
  suite_name="$1"
  pnpm_milliseconds="$2"
  bun_milliseconds="$3"
  pnpm_seconds=$(awk -v ms="$pnpm_milliseconds" 'BEGIN { printf "%.3f", ms / 1000 }')
  bun_seconds=$(awk -v ms="$bun_milliseconds" 'BEGIN { printf "%.3f", ms / 1000 }')
  speedup=$(awk -v p="$pnpm_milliseconds" -v b="$bun_milliseconds" 'BEGIN {
    if (b == 0) { print "n/a"; exit }
    printf "%.2fx", p / b
  }')
  printf '| %s | %s | %s | %s |\n' "$suite_name" "$pnpm_seconds" "$bun_seconds" "$speedup"
}

append_summary() {
  markdown_table="$1"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## Bun Runtime Pilot Results"
      echo
      echo "$markdown_table"
    } >> "$GITHUB_STEP_SUMMARY"
  fi
}

cd "$REPO_ROOT"

case "$SUITE" in
  all) SUITES="node ui api" ;;
  node|ui|api) SUITES="$SUITE" ;;
  *)
    echo "Invalid suite '$SUITE' (expected: all, node, ui, api)" >&2
    exit 1
    ;;
esac

echo "Bun runtime pilot (Vitest)"
echo "repo: $REPO_ROOT"
echo "suite: $SUITE"
echo "repeats: $REPEATS"
echo "bun_version: $BUN_VERSION"
echo

TABLE='| Suite | pnpm + vitest (s) | bunx + vitest (s) | Speedup |\n| --- | ---: | ---: | ---: |\n'

for suite_name in $SUITES; do
  test_path=$(get_suite_path "$suite_name")
  echo "----"
  echo "Suite: $suite_name"
  echo "Test:  $test_path"

  run_with_average_milliseconds "pnpm + vitest [$suite_name]" pnpm exec vitest run "$test_path"
  pnpm_avg="$LAST_AVG_MILLISECONDS"

  run_with_average_milliseconds "bunx + vitest [$suite_name]" run_bunx_vitest "$test_path"
  bun_avg="$LAST_AVG_MILLISECONDS"

  row=$(print_row "$suite_name" "$pnpm_avg" "$bun_avg")
  TABLE="${TABLE}${row}\n"
done

echo
printf '%b' "$TABLE"
append_summary "$(printf '%b' "$TABLE")"
