#!/bin/sh
set -eu

HEADLESS=0
ROOT_DIR="$(pwd)"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --headless)
      HEADLESS=1
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--headless]"
      exit 1
      ;;
  esac
done

TOTAL_START=$(date +%s)

echo "==> Running lint..."
LINT_START=$(date +%s)
pnpm lint
LINT_END=$(date +%s)
LINT_TIME=$((LINT_END - LINT_START))

echo "==> Running build..."
BUILD_START=$(date +%s)
pnpm build
BUILD_END=$(date +%s)
BUILD_TIME=$((BUILD_END - BUILD_START))

echo "==> Running unit tests..."
UNIT_START=$(date +%s)
echo "==> Rebuilding better-sqlite3-multiple-ciphers for Node..."
NODE_GYP_REL=$(find node_modules/.pnpm -path '*/node-gyp/bin/node-gyp.js' -print -quit 2>/dev/null || true)
SQLITE_MODULE_REL=$(find node_modules/.pnpm -path '*/better-sqlite3-multiple-ciphers' -print -quit 2>/dev/null || true)
NODE_GYP_PATH="${ROOT_DIR}/${NODE_GYP_REL}"
SQLITE_MODULE_DIR="${ROOT_DIR}/${SQLITE_MODULE_REL}"
if [ -z "$NODE_GYP_PATH" ] || [ -z "$SQLITE_MODULE_DIR" ]; then
  echo "Failed to locate node-gyp or better-sqlite3-multiple-ciphers for rebuild."
  exit 1
fi
(cd "$SQLITE_MODULE_DIR" && node "$NODE_GYP_PATH" rebuild --release)
pnpm test
UNIT_END=$(date +%s)
UNIT_TIME=$((UNIT_END - UNIT_START))

echo "==> Running Playwright E2E tests..."
PLAYWRIGHT_START=$(date +%s)
pnpm --filter @rapid/client test:e2e
PLAYWRIGHT_END=$(date +%s)
PLAYWRIGHT_TIME=$((PLAYWRIGHT_END - PLAYWRIGHT_START))

echo "==> Running Android Maestro tests..."
ANDROID_START=$(date +%s)
if [ "$HEADLESS" -eq 1 ]; then
  pnpm --filter @rapid/client test:maestro:android -- --headless
else
  pnpm --filter @rapid/client test:maestro:android
fi
ANDROID_END=$(date +%s)
ANDROID_TIME=$((ANDROID_END - ANDROID_START))

echo "==> Running iOS Maestro tests..."
IOS_START=$(date +%s)
if [ "$HEADLESS" -eq 1 ]; then
  pnpm --filter @rapid/client test:maestro:ios -- --headless
else
  pnpm --filter @rapid/client test:maestro:ios
fi
IOS_END=$(date +%s)
IOS_TIME=$((IOS_END - IOS_START))

echo "==> Running Electron tests..."
ELECTRON_START=$(date +%s)
echo "==> Rebuilding better-sqlite3-multiple-ciphers for Electron..."
pnpm --filter @rapid/client exec electron-rebuild -f -o better-sqlite3-multiple-ciphers
pnpm --filter @rapid/client electron:test
ELECTRON_END=$(date +%s)
ELECTRON_TIME=$((ELECTRON_END - ELECTRON_START))

TOTAL_END=$(date +%s)
TOTAL_TIME=$((TOTAL_END - TOTAL_START))

echo ""
echo "=============================="
echo "       Timing Summary"
echo "=============================="
echo "Lint:            ${LINT_TIME}s"
echo "Build:           ${BUILD_TIME}s"
echo "Unit tests:      ${UNIT_TIME}s"
echo "Playwright E2E:  ${PLAYWRIGHT_TIME}s"
echo "Android Maestro: ${ANDROID_TIME}s"
echo "iOS Maestro:     ${IOS_TIME}s"
echo "Electron tests:  ${ELECTRON_TIME}s"
echo "------------------------------"
echo "Total:          ${TOTAL_TIME}s"
echo "=============================="
