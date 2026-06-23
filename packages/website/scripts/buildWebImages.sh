#!/bin/sh
set -e

# Build website favicon assets into the build output directory.
#
# Sourced from the shared brand logo in @tearleads/ui and generated into dist/
# (gitignored) after `astro build`, so the deploy rsync ships them.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"

SVG_SOURCE="$REPO_ROOT/packages/ui/assets/logo.svg"
OUTPUT_DIR="$PACKAGE_DIR/dist"

exec "$REPO_ROOT/scripts/buildFaviconImages.sh" "$SVG_SOURCE" "$OUTPUT_DIR"
