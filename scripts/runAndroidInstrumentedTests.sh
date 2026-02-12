#!/bin/sh
# Run Android instrumented tests (connectedAndroidTest) with optional headless mode.
#
# Usage:
#   ./scripts/runAndroidInstrumentedTests.sh [--headless] [--release] [--avd <name>]
#
# Options:
#   --headless   Run emulator without window (headless mode)
#   --release    Run tests against the release build (default: debug)
#   --avd <name> Specify AVD name (default: first available)
#   --help, -h   Show this help message
#
# Examples:
#   ./scripts/runAndroidInstrumentedTests.sh                    # Run debug tests with UI
#   ./scripts/runAndroidInstrumentedTests.sh --headless         # Run debug tests headless
#   ./scripts/runAndroidInstrumentedTests.sh --release          # Run release tests with UI
#   ./scripts/runAndroidInstrumentedTests.sh --headless --release
#
# Requirements:
#   - Android SDK with emulator and platform-tools
#   - At least one AVD configured (via Android Studio or avdmanager)
#   - Ruby with Bundler for Fastlane

set -eu

# Resolve script directory
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

# Defaults
HEADLESS=0
RELEASE=0
AVD_NAME=""

# Parse arguments
while [ "$#" -gt 0 ]; do
  case "$1" in
    --)
      shift
      ;;
    --headless)
      HEADLESS=1
      shift
      ;;
    --release)
      RELEASE=1
      shift
      ;;
    --avd)
      if [ -z "${2:-}" ]; then
        echo "Error: Missing value for --avd" >&2
        exit 1
      fi
      AVD_NAME="$2"
      shift 2
      ;;
    --help|-h)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Run with --help for usage" >&2
      exit 1
      ;;
  esac
done

cd "$SCRIPT_DIR/../packages/client"

# Check for required tools
if ! command -v emulator >/dev/null 2>&1; then
  echo "Error: Android emulator not found. Ensure ANDROID_HOME is set and emulator is in PATH." >&2
  exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
  echo "Error: adb not found. Ensure ANDROID_HOME is set and platform-tools is in PATH." >&2
  exit 1
fi

# Find or start emulator
start_emulator() {
  if [ -z "$AVD_NAME" ]; then
    AVD_NAME=$(emulator -list-avds | head -n 1)
    if [ -z "$AVD_NAME" ]; then
      echo "Error: No Android AVDs found." >&2
      echo "Create one with: avdmanager create avd -n test -k 'system-images;android-31;default;x86_64'" >&2
      exit 1
    fi
  fi

  echo "==> Starting emulator: $AVD_NAME"
  if [ "$HEADLESS" -eq 1 ]; then
    echo "    (headless mode: -no-window -no-audio -no-boot-anim)"
    emulator -avd "$AVD_NAME" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect &
  else
    emulator -avd "$AVD_NAME" &
  fi
  EMULATOR_PID=$!

  echo "==> Waiting for emulator to become available..."
  adb wait-for-device

  echo "==> Waiting for boot to complete..."
  BOOT_TIMEOUT=300
  ELAPSED=0
  while [ "$(adb shell getprop sys.boot_completed 2>/dev/null || echo 0)" != "1" ]; do
    if [ "$ELAPSED" -ge "$BOOT_TIMEOUT" ]; then
      echo "Error: Emulator boot timed out after ${BOOT_TIMEOUT}s" >&2
      kill "$EMULATOR_PID" 2>/dev/null || true
      exit 1
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
  done

  # Dismiss any system dialogs
  adb shell input keyevent 82 || true
  echo "==> Emulator is ready (boot completed in ${ELAPSED}s)"
}

# Check if emulator is already running
if adb devices 2>/dev/null | grep -q "emulator.*device"; then
  SERIAL=$(adb devices | awk 'NR>1 && /emulator.*device/{print $1}' | head -n 1)
  echo "==> Emulator already running: $SERIAL"
else
  start_emulator
fi

# Build web assets if needed
if [ ! -d "dist" ] || [ ! -f "dist/index.html" ]; then
  echo "==> Building web assets..."
  pnpm build
fi

# Sync Capacitor
echo "==> Syncing Capacitor..."
pnpm cap:sync

# Run instrumented tests
echo "==> Running instrumented tests..."
if [ "$RELEASE" -eq 1 ]; then
  echo "    (release build)"
  bundle exec fastlane android test_instrumented_release
else
  echo "    (debug build)"
  bundle exec fastlane android test_instrumented
fi

echo "==> Instrumented tests completed successfully"
