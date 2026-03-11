#!/usr/bin/env bash
# Refresh workspace after a PR is merged: switches to main, pulls latest,
# installs dependencies, builds TypeScript and Rust packages, then resets title
# to '<workspace> - main'.
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

REPO_ROOT="$(git rev-parse --show-toplevel)"
CLIENT_DIR="$REPO_ROOT/packages/client"
HOST_OS="$(uname -s)"

cd "$REPO_ROOT"

# Switch to main and pull latest
echo "Switching to main and pulling latest..."
git switch main
git pull

# Ensure correct Node.js version is active
echo "Installing Node.js version from .nvmrc via mise..."
mise install node

# Install pnpm dependencies
echo "Installing pnpm dependencies..."
pnpm install

# Build TypeScript packages
echo "Building TypeScript packages..."
pnpm build

# Build Rust crates when the workspace has a Cargo manifest.
if [ -f "$REPO_ROOT/Cargo.toml" ]; then
  command -v cargo >/dev/null 2>&1 || {
    echo "Error: cargo is required to build Rust crates. Install Rust toolchain and retry." >&2
    exit 1
  }

  # Clear RUSTC_WRAPPER if the wrapper binary isn't on PATH
  if [[ -n "${RUSTC_WRAPPER:-}" ]] && ! command -v "$RUSTC_WRAPPER" &>/dev/null; then
    echo "RUSTC_WRAPPER=$RUSTC_WRAPPER not found in PATH; building without it." >&2
    unset RUSTC_WRAPPER
  fi

  echo "Building Rust crates..."
  cargo build --workspace
else
  echo "No Cargo workspace found; skipping Rust build."
fi

# Sync Capacitor web assets to native projects.
# iOS sync can invoke CocoaPods, so non-macOS hosts should sync Android only.
echo "Syncing Capacitor..."
cd "$CLIENT_DIR"
if [ "$HOST_OS" = "Darwin" ]; then
  pnpm cap sync

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
  pnpm cap sync android
  echo "Skipping Ruby/CocoaPods install on non-macOS host."
fi

# Return to repo root
cd "$REPO_ROOT"

# Sweep stale Rust build artifacts from this workspace (non-fatal)
if [ -x "$REPO_ROOT/scripts/sweepRustTargets.sh" ]; then
  echo "Sweeping stale Rust build artifacts..."
  "$REPO_ROOT/scripts/sweepRustTargets.sh" || echo "Warning: Failed to sweep stale Rust build artifacts." >&2
fi

# Reset title to '<workspace> - <branch>'
"$SCRIPT_DIR/setVscodeTitle.ts"

echo "Ready for next task."
