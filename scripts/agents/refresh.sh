#!/bin/sh
# Refresh workspace after a PR is merged: switches to main, pulls latest,
# installs dependencies, builds packages, and sets VS Code title to "ready".
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if command -v git >/dev/null 2>&1 && git -C "${PWD}" rev-parse --show-toplevel >/dev/null 2>&1; then
    REPO_ROOT=$(git -C "$PWD" rev-parse --show-toplevel)
else
    REPO_ROOT="$SCRIPT_REPO_ROOT"
fi
CLIENT_DIR="$REPO_ROOT/packages/client"

cd "$REPO_ROOT"

# Switch to main and pull latest
echo "Switching to main and pulling latest..."
git switch main
git pull

# Install pnpm dependencies
echo "Installing pnpm dependencies..."
pnpm install

# Build TypeScript packages
echo "Building TypeScript packages..."
pnpm build

# Install Ruby gems (for fastlane, cocoapods, etc.)
echo "Installing Ruby gems..."
cd "$CLIENT_DIR"
bundle install

# Update CocoaPods
echo "Updating CocoaPods..."
cd "$CLIENT_DIR/ios/App"
bundle exec pod install

# Return to repo root
cd "$REPO_ROOT"

# Clear queued status (resets VS Code title and tmux window, moves to back)
"$SCRIPT_DIR/clearQueued.sh"

echo "Ready for next task."
