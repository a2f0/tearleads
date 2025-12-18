#!/bin/sh
set -eu

TOTAL_START=$(date +%s)

CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Error: Must be on 'main' branch to release. Currently on '$CURRENT_BRANCH'."
  exit 1
fi

git fetch origin main
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main)

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "Error: Local main is not up-to-date with origin/main."
  echo "  Local:  $LOCAL_SHA"
  echo "  Remote: $REMOTE_SHA"
  echo "Please pull the latest changes first."
  exit 1
fi

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

TOTAL_END=$(date +%s)
TOTAL_TIME=$((TOTAL_END - TOTAL_START))

echo ""
echo "=============================="
echo "       Timing Summary"
echo "=============================="
echo "Lint:           ${LINT_TIME}s"
echo "Build:          ${BUILD_TIME}s"
echo "Android tests:  ${ANDROID_TIME}s"
echo "iOS tests:      ${IOS_TIME}s"
echo "------------------------------"
echo "Total:          ${TOTAL_TIME}s"
echo "=============================="
