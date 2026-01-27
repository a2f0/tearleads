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

# Set PW_DEBUG_HANDLES=true to dump verbose handle info after tests complete.
: "${PW_DEBUG_HANDLES:=false}"

# Check if test port is already in use
pnpm exec tsx "$SCRIPT_DIR/checkPort.ts" "$PW_TEST_PORT"

cd "$SCRIPT_DIR/../packages/client"

# Cleanup function to kill any orphaned processes on the test port
# shellcheck disable=SC2329 # Function is invoked via trap
cleanup() {
  # Find and kill any process listening on PW_TEST_PORT
  # This handles orphaned vite processes that survive pnpm termination
  if command -v lsof >/dev/null 2>&1; then
    PIDS=$(lsof -ti:"$PW_TEST_PORT" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      echo "[cleanup] Killing orphaned processes on port $PW_TEST_PORT: $PIDS"
      echo "$PIDS" | xargs kill -9 2>/dev/null || true
    fi
  fi
}

# Always run cleanup on exit (success or failure)
trap cleanup EXIT

echo "==> Running Playwright tests..."
START_TIME=$(date +%s)
# PW_OWN_SERVER=true ensures Playwright fully controls server lifecycle (no hanging)
# BASE_URL uses port 3002 to avoid conflict with any running dev server on 3000
BASE_URL=http://localhost:$PW_TEST_PORT PW_OWN_SERVER=true PW_DEBUG_HANDLES="$PW_DEBUG_HANDLES" pnpm test:e2e -- "$@"
EXIT_CODE=$?
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINS=$((ELAPSED / 60))
SECS=$((ELAPSED % 60))
echo "==> Playwright tests completed in ${MINS}m ${SECS}s (exit code: $EXIT_CODE)"
exit $EXIT_CODE
