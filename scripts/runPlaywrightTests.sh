#!/bin/sh
# Usage:
#   ./scripts/runPlaywrightTests.sh [options] [test-file]
#
# Examples:
#   ./scripts/runPlaywrightTests.sh                     # Run all tests
#   ./scripts/runPlaywrightTests.sh tests/index.spec.ts # Run a specific test file
#   ./scripts/runPlaywrightTests.sh -g "login"          # Run tests matching "login"
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

# Port used for Playwright test server (different from dev server on 3000)
PW_TEST_PORT=3002

# Always dump handle info to help diagnose hanging issues
PW_DEBUG_HANDLES=true

# Check if test port is already in use
pnpm exec tsx "$SCRIPT_DIR/checkPort.ts" "$PW_TEST_PORT"

cd "$SCRIPT_DIR/../packages/client"

# Cleanup function to kill any orphaned processes on the test port
# shellcheck disable=SC2317,SC2329 # Function is invoked via trap
cleanup() {
  if [ -n "${VITE_PID:-}" ] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill -TERM "$VITE_PID" 2>/dev/null || true
    WAIT_SECS=0
    while kill -0 "$VITE_PID" 2>/dev/null && [ "$WAIT_SECS" -lt 5 ]; do
      sleep 1
      WAIT_SECS=$((WAIT_SECS + 1))
    done
    if kill -0 "$VITE_PID" 2>/dev/null; then
      kill -KILL "$VITE_PID" 2>/dev/null || true
    fi
    wait "$VITE_PID" 2>/dev/null || true
  fi
  # Find and kill any process listening on PW_TEST_PORT
  # This handles orphaned vite processes that survive pnpm termination
  if command -v lsof >/dev/null 2>&1; then
    PIDS=$(lsof -ti:"$PW_TEST_PORT" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      echo "[cleanup] Stopping orphaned processes on port $PW_TEST_PORT: $PIDS"
      for pid in $PIDS; do
        if [ -n "${VITE_PID:-}" ] && [ "$pid" = "$VITE_PID" ]; then
          continue
        fi
        kill -TERM "$pid" 2>/dev/null || true
      done
      sleep 1
      for pid in $PIDS; do
        if [ -n "${VITE_PID:-}" ] && [ "$pid" = "$VITE_PID" ]; then
          continue
        fi
        if kill -0 "$pid" 2>/dev/null; then
          kill -KILL "$pid" 2>/dev/null || true
        fi
      done
    fi
  fi
}

# Always run cleanup on exit (success or failure)
trap cleanup EXIT

echo "==> Running Playwright tests..."
START_TIME=$(date +%s)
PW_JSON_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/playwright-results.XXXXXX")
# Start Vite directly so the script owns the server lifecycle.
VITE_API_URL=http://localhost:5001/v1 DOTENV_CONFIG_QUIET=true ./node_modules/.bin/vite --port "$PW_TEST_PORT" &
VITE_PID=$!

MAX_WAIT=60
WAITED=0
BASE_URL=http://localhost:$PW_TEST_PORT
until curl -fsS "$BASE_URL" >/dev/null 2>&1; do
  sleep 1
  WAITED=$((WAITED + 1))
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    echo "[error] Vite did not start within ${MAX_WAIT}s on $BASE_URL"
    exit 1
  fi
done

# PW_EXTERNAL_SERVER=true disables Playwright webServer so this script controls lifecycle.
# BASE_URL uses port 3002 to avoid conflict with any running dev server on 3000.
set +e
BASE_URL="$BASE_URL" PW_EXTERNAL_SERVER=true PW_DEBUG_HANDLES="$PW_DEBUG_HANDLES" PLAYWRIGHT_JSON_OUTPUT_FILE="$PW_JSON_OUTPUT" pnpm exec playwright test --reporter=json "$@"
CMD_EXIT_CODE=$?
set -e

JSON_FAILED_COUNT=$(node -e '
const fs = require("node:fs");
const path = process.argv[1];
try {
  const report = JSON.parse(fs.readFileSync(path, "utf8"));
  const stats = report && typeof report === "object" ? report.stats : undefined;
  const unexpected = Number((stats && stats.unexpected) || 0);
  const flaky = Number((stats && stats.flaky) || 0);
  process.stdout.write(String(unexpected + flaky));
} catch {
  process.stdout.write("parse-error");
}
' "$PW_JSON_OUTPUT")

if [ "$CMD_EXIT_CODE" -ne 0 ]; then
  EXIT_CODE=$CMD_EXIT_CODE
elif [ "$JSON_FAILED_COUNT" = "parse-error" ]; then
  echo "[error] Unable to parse Playwright JSON report at $PW_JSON_OUTPUT"
  EXIT_CODE=1
elif [ "$JSON_FAILED_COUNT" -gt 0 ]; then
  echo "[error] Playwright reported $JSON_FAILED_COUNT failing test(s)"
  EXIT_CODE=1
else
  EXIT_CODE=0
fi

rm -f "$PW_JSON_OUTPUT"
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINS=$((ELAPSED / 60))
SECS=$((ELAPSED % 60))
echo "==> Playwright tests completed in ${MINS}m ${SECS}s (exit code: $EXIT_CODE)"
exit $EXIT_CODE
