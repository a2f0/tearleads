#!/usr/bin/env bash
# Refresh workspace after a PR is merged: switches to main, pulls latest,
# installs dependencies, builds packages, then resets title to '<workspace> - main'.
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

REPO_ROOT="$(git rev-parse --show-toplevel)"
CLIENT_DIR="$REPO_ROOT/packages/client"

cd "$REPO_ROOT"

# Switch to main and pull latest
echo "Switching to main and pulling latest..."
git switch main
git pull

# Ensure correct Node.js version is active
echo "Installing Node.js version from .nvmrc..."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install

# Install pnpm dependencies
echo "Installing pnpm dependencies..."
pnpm install

# Build TypeScript packages
echo "Building TypeScript packages..."
pnpm build

# Sync Capacitor web assets to native projects
echo "Syncing Capacitor..."
cd "$CLIENT_DIR"
pnpm cap sync

# CocoaPods/iOS dependency install is only supported on macOS hosts.
if [ "$(uname -s)" = "Darwin" ]; then
  # Install Ruby gems (for fastlane, cocoapods, etc.)
  echo "Installing Ruby gems..."
  bundle install

  # Install CocoaPods using the committed Podfile.lock.
  # Clean installs belong in update-everything (when dependencies change),
  # not in refresh (which restores to the committed state).
  echo "Installing CocoaPods..."
  cd "$CLIENT_DIR/ios/App"
  bundle exec pod install
else
  echo "Skipping Ruby/CocoaPods install on non-macOS host."
fi

# Return to repo root
cd "$REPO_ROOT"

# Reset title to '<workspace> - <branch>'
"$SCRIPT_DIR/setVscodeTitle.ts"

echo "Ready for next task."
