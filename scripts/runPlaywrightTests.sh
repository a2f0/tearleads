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

# Set PW_DEBUG_HANDLES=true to dump open handle info after tests complete.
: "${PW_DEBUG_HANDLES:=false}"

cd "$SCRIPT_DIR/../packages/client"

echo "==> Running Playwright tests..."
PW_DEBUG_HANDLES="$PW_DEBUG_HANDLES" pnpm test:e2e -- "$@"
