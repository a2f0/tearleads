#!/bin/sh
# Usage:
#   ./scripts/runElectronTests.sh [options] [test-file]
#
# Examples:
#   ./scripts/runElectronTests.sh                              # Run all Electron tests
#   ./scripts/runElectronTests.sh database.spec.ts             # Run a specific test file
#   ./scripts/runElectronTests.sh -g "persist data"            # Run tests matching pattern
#   ./scripts/runElectronTests.sh --headed                     # Run with visible window
set -eu

cd "$(dirname "$0")/../packages/client"

echo "==> Building Electron app..."
pnpm electron:build

echo "==> Running Electron tests..."
npx playwright test --config=playwright.electron.config.ts "$@"
