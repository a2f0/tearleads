#!/bin/sh
set -eu

# Install Appium drivers
# This script works around pnpm workspace issues with Appium driver installation

SCRIPT_DIR="$(dirname "$0")"
cd "$SCRIPT_DIR/../packages/client"

echo "==> Installing Appium drivers for project..."

# Set APPIUM_HOME to project location so drivers are available to the wdio service
export APPIUM_HOME="$PWD/.appium"

# Install drivers using npm directly to avoid pnpm workspace conflicts
# Use specific versions compatible with Appium 2.x (latest versions require Appium 3.x)
npm exec -- appium driver install appium-uiautomator2-driver@3.8.0 --source=npm 2>&1 || true
npm exec -- appium driver install appium-xcuitest-driver@7.0.0 --source=npm 2>&1 || true

# List installed drivers
npm exec -- appium driver list

echo "==> Drivers installed to $APPIUM_HOME"
