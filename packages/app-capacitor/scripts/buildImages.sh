#!/bin/sh
set -e

# Build all native image assets from SVG source

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Building Android images ==="
sh "$SCRIPT_DIR/buildAndroidImages.sh"

echo ""
echo "=== Building iOS images ==="
sh "$SCRIPT_DIR/buildIosImages.sh"

echo ""
echo "All native image assets generated successfully."
