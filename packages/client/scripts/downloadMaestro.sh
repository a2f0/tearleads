#!/bin/sh
set -e

# Downloads the latest Maestro from GitHub releases
# Maestro is Java-based, so one zip works for all platforms

INSTALL_DIR="$HOME/.maestro"
BIN_DIR="$INSTALL_DIR/bin"

# Check for dependencies
if ! command -v unzip >/dev/null 2>&1; then
    echo "Error: unzip is required but not found. Please install it." >&2
    exit 1
fi

# Determine downloader
if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
else
    echo "Error: Neither curl nor wget found. Please install one of them." >&2
    exit 1
fi

# Check if maestro already exists
if [ -f "$BIN_DIR/maestro" ]; then
    INSTALLED_VERSION=$("$BIN_DIR/maestro" --version 2>/dev/null | tail -1 || echo "unknown")
    echo "Maestro already installed at $BIN_DIR/maestro (version: $INSTALLED_VERSION)"
    echo "To reinstall, remove $INSTALL_DIR and run this script again"
    exit 0
fi

# Use direct download URL that bypasses GitHub API (avoids rate limiting)
# This URL auto-redirects to the latest release
DOWNLOAD_URL="https://github.com/mobile-dev-inc/maestro/releases/latest/download/maestro.zip"

echo "Installing latest Maestro version..."
echo "Downloading from GitHub..."
echo "  URL: $DOWNLOAD_URL"

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

ZIP_FILE="$TEMP_DIR/maestro.zip"

if [ "$DOWNLOADER" = "curl" ]; then
    curl -fSL -o "$ZIP_FILE" "$DOWNLOAD_URL"
else
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
