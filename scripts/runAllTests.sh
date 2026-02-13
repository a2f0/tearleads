#!/bin/sh
set -eu

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
# Check that test port is not already in use
pnpm exec tsx ./scripts/checkPort.ts 3002

# Start vite dev server in background (same approach as runPlaywrightTests.sh)
cd packages/client
VITE_API_URL=http://localhost:5001/v1 DOTENV_CONFIG_QUIET=true pnpm exec vite --port 3002 &
VITE_PID=$!
cd ../..

# Wait for vite to be ready
MAX_WAIT=60
WAITED=0
echo "[playwright] Waiting for vite server on port 3002..."
while ! nc -z localhost 3002 2>/dev/null; do
  sleep 1
  WAITED=$((WAITED + 1))
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    echo "[playwright] Timeout waiting for vite server"
    kill -9 "$VITE_PID" 2>/dev/null || true
    exit 1
  fi
done
echo "[playwright] Vite server ready after ${WAITED}s"

# PW_EXTERNAL_SERVER=true disables Playwright webServer so this script controls lifecycle.
# BASE_URL uses port 3002 to avoid conflict with any running dev server on 3000.
BASE_URL=http://localhost:3002 PW_EXTERNAL_SERVER=true PW_FORCE_EXIT=true pnpm --filter @tearleads/client test:e2e && PW_EXIT_CODE=0 || PW_EXIT_CODE=$?

# Clean up vite server
echo "[playwright] Stopping vite server (pid: $VITE_PID)..."
kill -TERM "$VITE_PID" 2>/dev/null || true
sleep 1
kill -KILL "$VITE_PID" 2>/dev/null || true

# Clean up any orphaned vite processes on test port
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti:3002 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "[cleanup] Killing orphaned processes on port 3002: $PIDS"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
  fi
fi
if [ "$PW_EXIT_CODE" -ne 0 ]; then
  exit "$PW_EXIT_CODE"
fi
PLAYWRIGHT_END=$(date +%s)
PLAYWRIGHT_TIME=$((PLAYWRIGHT_END - PLAYWRIGHT_START))

echo "==> Running Android Maestro tests..."
ANDROID_START=$(date +%s)
if [ "$HEADLESS" -eq 1 ]; then
  pnpm --filter @tearleads/client test:maestro:android -- --headless
else
  pnpm --filter @tearleads/client test:maestro:android
fi
ANDROID_END=$(date +%s)
ANDROID_TIME=$((ANDROID_END - ANDROID_START))

echo "==> Running iOS Maestro tests..."
IOS_START=$(date +%s)
if [ "$HEADLESS" -eq 1 ]; then
  pnpm --filter @tearleads/client test:maestro:ios -- --headless
else
  pnpm --filter @tearleads/client test:maestro:ios
fi
IOS_END=$(date +%s)
IOS_TIME=$((IOS_END - IOS_START))

echo "==> Running Electron tests..."
ELECTRON_START=$(date +%s)
pnpm --filter @tearleads/client electron:test
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
