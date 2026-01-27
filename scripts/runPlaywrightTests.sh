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

# Set PW_DEBUG_HANDLES=true to dump verbose handle info after tests complete.
: "${PW_DEBUG_HANDLES:=false}"

cd "$SCRIPT_DIR/../packages/client"

echo "==> Running Playwright tests..."
START_TIME=$(date +%s)
# PW_OWN_SERVER=true ensures Playwright fully controls server lifecycle (no hanging)
# BASE_URL uses port 3002 to avoid conflict with any running dev server on 3000
BASE_URL=http://localhost:3002 PW_OWN_SERVER=true PW_DEBUG_HANDLES="$PW_DEBUG_HANDLES" pnpm test:e2e -- "$@"
EXIT_CODE=$?
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINS=$((ELAPSED / 60))
SECS=$((ELAPSED % 60))
echo "==> Playwright tests completed in ${MINS}m ${SECS}s (exit code: $EXIT_CODE)"
exit $EXIT_CODE
