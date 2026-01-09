#!/bin/sh
set -eu

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
pnpm --filter @rapid/client test:maestro:android
ANDROID_END=$(date +%s)
ANDROID_TIME=$((ANDROID_END - ANDROID_START))

echo "==> Running iOS Maestro tests..."
IOS_START=$(date +%s)
pnpm --filter @rapid/client test:maestro:ios
IOS_END=$(date +%s)
IOS_TIME=$((IOS_END - IOS_START))

echo "==> Running Electron tests..."
ELECTRON_START=$(date +%s)
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
