#!/bin/sh
set -e

# Downloads the latest Maestro from GitHub releases
# Maestro is Java-based, so one zip works for all platforms

INSTALL_DIR="$HOME/.maestro"
BIN_DIR="$INSTALL_DIR/bin"

# Check if maestro already exists
if [ -f "$BIN_DIR/maestro" ]; then
    INSTALLED_VERSION=$("$BIN_DIR/maestro" --version 2>/dev/null | tail -1 || echo "unknown")
    echo "Maestro already installed at $BIN_DIR/maestro (version: $INSTALLED_VERSION)"
    echo "To reinstall, remove $INSTALL_DIR and run this script again"
    exit 0
fi

# Get latest version from GitHub API
echo "Fetching latest Maestro version..."
if command -v curl > /dev/null 2>&1; then
    MAESTRO_VERSION=$(curl -fsSL https://api.github.com/repos/mobile-dev-inc/maestro/releases/latest | grep '"tag_name"' | sed 's/.*"tag_name": *"cli-\([^"]*\)".*/\1/')
elif command -v wget > /dev/null 2>&1; then
    MAESTRO_VERSION=$(wget -qO- https://api.github.com/repos/mobile-dev-inc/maestro/releases/latest | grep '"tag_name"' | sed 's/.*"tag_name": *"cli-\([^"]*\)".*/\1/')
else
    echo "Error: Neither curl nor wget found. Please install one of them."
    exit 1
fi

if [ -z "$MAESTRO_VERSION" ]; then
    echo "Error: Could not determine latest Maestro version"
    exit 1
fi

echo "Installing Maestro version: $MAESTRO_VERSION"

DOWNLOAD_URL="https://github.com/mobile-dev-inc/maestro/releases/download/cli-$MAESTRO_VERSION/maestro.zip"

echo "Downloading Maestro from GitHub..."
echo "  URL: $DOWNLOAD_URL"

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

ZIP_FILE="$TEMP_DIR/maestro.zip"

if command -v curl > /dev/null 2>&1; then
    curl -fSL -o "$ZIP_FILE" "$DOWNLOAD_URL"
elif command -v wget > /dev/null 2>&1; then
    wget -q -O "$ZIP_FILE" "$DOWNLOAD_URL"
fi

echo "Extracting Maestro..."

# Extract to temp dir first (zip contains maestro/ folder)
unzip -q -o "$ZIP_FILE" -d "$TEMP_DIR"

# Move contents to install dir
rm -rf "$INSTALL_DIR"
mv "$TEMP_DIR/maestro" "$INSTALL_DIR"

# Make executable
chmod +x "$BIN_DIR/maestro"

echo "Maestro installed successfully to $BIN_DIR/maestro"
echo ""
echo "Add Maestro to your PATH by adding this to your shell profile:"
echo "  export PATH=\"\$PATH:\$HOME/.maestro/bin\""
