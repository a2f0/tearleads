#!/bin/sh
# Usage:
#   ./scripts/runPlaywrightTests.sh [options] [test-file]
#
# Examples:
#   ./scripts/runPlaywrightTests.sh                     # Run all tests
#   ./scripts/runPlaywrightTests.sh tests/index.spec.ts # Run a specific test file
#   ./scripts/runPlaywrightTests.sh -g "login"          # Run tests matching "login"
set -eu

cd "$(dirname "$0")/../packages/client"

echo "==> Building the app..."
pnpm build

echo "==> Running Playwright tests..."
pnpm test:e2e -- "$@"
