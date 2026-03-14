#!/bin/sh
set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
PM_SCRIPT="$SCRIPT_DIR/tooling/pm.sh"

HEADLESS=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --headed)
      HEADLESS=0
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--headed]"
      exit 1
      ;;
  esac
done

# Ensure gradle wrapper is present (idempotent - script exits early if already exists)
./packages/client/scripts/downloadGradleWrapper.sh

TOTAL_START=$(date +%s)

echo "==> Running lint..."
LINT_START=$(date +%s)
sh "$PM_SCRIPT" run lint
LINT_END=$(date +%s)
LINT_TIME=$((LINT_END - LINT_START))

echo "==> Running build..."
BUILD_START=$(date +%s)
sh "$PM_SCRIPT" run build
BUILD_END=$(date +%s)
BUILD_TIME=$((BUILD_END - BUILD_START))

echo "==> Running unit tests..."
UNIT_START=$(date +%s)
# Run Vitest-configured packages through the workspace runner, then execute the
# remaining Bun-only package test scripts explicitly, and finally run tuxedo.
sh "$PM_SCRIPT" exec vitest run
for PACKAGE_NAME in \
  @tearleads/api \
  @tearleads/app-admin \
  @tearleads/app-audio \
  @tearleads/app-backups \
  @tearleads/app-builder \
  @tearleads/app-keychain \
  @tearleads/chrome-extension \
  @tearleads/vfs-explorer \
  @tearleads/vfs-sync
do
  sh "$PM_SCRIPT" --filter "$PACKAGE_NAME" run test
done
sh "$PM_SCRIPT" run test:tuxedo
UNIT_END=$(date +%s)
UNIT_TIME=$((UNIT_END - UNIT_START))

echo "==> Running Playwright E2E tests..."
PLAYWRIGHT_START=$(date +%s)
./scripts/runPlaywrightTests.sh
PLAYWRIGHT_END=$(date +%s)
PLAYWRIGHT_TIME=$((PLAYWRIGHT_END - PLAYWRIGHT_START))

echo "==> Running Android Maestro tests..."
ANDROID_START=$(date +%s)
if [ "$HEADLESS" -eq 1 ]; then
  sh "$PM_SCRIPT" --filter @tearleads/client run test:maestro:android -- --headless
else
  sh "$PM_SCRIPT" --filter @tearleads/client run test:maestro:android
fi
ANDROID_END=$(date +%s)
ANDROID_TIME=$((ANDROID_END - ANDROID_START))

echo "==> Running iOS Maestro tests..."
IOS_START=$(date +%s)
if [ "$HEADLESS" -eq 1 ]; then
  sh "$PM_SCRIPT" --filter @tearleads/client run test:maestro:ios -- --headless
else
  sh "$PM_SCRIPT" --filter @tearleads/client run test:maestro:ios
fi
IOS_END=$(date +%s)
IOS_TIME=$((IOS_END - IOS_START))

echo "==> Running Electron tests..."
ELECTRON_START=$(date +%s)
sh "$PM_SCRIPT" --filter @tearleads/client run electron:test
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
