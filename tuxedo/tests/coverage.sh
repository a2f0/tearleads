#!/bin/sh
set -eu

TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(cd -- "$TEST_DIR/../.." && pwd -P)

if command -v bashcov >/dev/null 2>&1; then
    BASHCOV_CMD="bashcov"
else
    BASHCOV_CMD="ruby -S bashcov"
fi

if ! $BASHCOV_CMD --version >/dev/null 2>&1; then
    echo "bashcov is required for coverage. Install with: gem install bashcov" >&2
    exit 1
fi

if ! command -v bash >/dev/null 2>&1; then
    echo "bash is required for bashcov shell coverage." >&2
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "node is required to generate coverage baselines." >&2
    exit 1
fi

DEFAULT_BASH=$(command -v bash)
DEFAULT_BASH_MAJOR=$("$DEFAULT_BASH" -c 'echo "${BASH_VERSINFO[0]}"')
if [ "$DEFAULT_BASH_MAJOR" -lt 4 ]; then
    echo "bash >= 4 is required for bashcov (install via brew install bash)." >&2
    exit 1
fi
ROOT_DIR="$REPO_ROOT/tuxedo"
COVERAGE_DIR="$TEST_DIR/coverage"
BASELINE_FILE="$TEST_DIR/coverage-baseline.txt"
RESULTSET_FILE="$COVERAGE_DIR/.resultset.json"

rm -rf "$COVERAGE_DIR" "$ROOT_DIR/coverage"

TUXEDO_TEST_SHELL="$DEFAULT_BASH" $BASHCOV_CMD --mute --bash-path "$DEFAULT_BASH" --root "$ROOT_DIR" --command-name tuxedo -- "$REPO_ROOT/tuxedo/tests/run.sh"

mv "$ROOT_DIR/coverage" "$COVERAGE_DIR"

node - "$RESULTSET_FILE" > "$BASELINE_FILE" <<'NODE'
const fs = require("fs");

const [resultPath] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const key = Object.keys(data)[0];
const coverage = data[key]?.coverage ?? {};

let total = 0;
let covered = 0;

for (const lines of Object.values(coverage)) {
  if (!Array.isArray(lines)) continue;
  for (const count of lines) {
    if (count === null || count === undefined) continue;
    total += 1;
    if (count > 0) covered += 1;
  }
}

const pct = total === 0 ? 0 : (covered / total) * 100;
console.log(`lines: ${covered}/${total} (${pct.toFixed(2)}%)`);
NODE

echo "Coverage report: $COVERAGE_DIR/index.html"
echo "Coverage summary: $BASELINE_FILE"
