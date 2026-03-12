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
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
PM_SCRIPT="$SCRIPT_DIR/tooling/pm.sh"

cd "$SCRIPT_DIR/../packages/client"

API_PORT=5001
export VITE_API_URL="${VITE_API_URL:-http://localhost:${API_PORT}/v1}"

echo "==> Building Electron app..."
sh "$PM_SCRIPT" run electron:build

echo "==> Running Electron tests..."
sh "$PM_SCRIPT" exec playwright test --config=playwright.electron.config.ts "$@"
