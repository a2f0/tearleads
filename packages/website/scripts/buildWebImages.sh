#!/bin/sh
set -e

# Build website favicon assets into the Astro public/ directory.
#
# Sourced from the shared brand logo in @symcrypt/ui and generated into
# public/ (gitignored). Astro serves public/ at the site root during `astro
# dev` and copies it into dist/ during `astro build`, so a single output
# location fixes dev 404s and still ships the icons in the deploy rsync.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"

SVG_SOURCE="$REPO_ROOT/packages/ui/assets/logo.svg"
OUTPUT_DIR="$PACKAGE_DIR/public"

# Invoke via sh (like package.json calls this script) so it works even if the
# executable bit is not preserved on checkout.
exec sh "$REPO_ROOT/scripts/buildFaviconImages.sh" "$SVG_SOURCE" "$OUTPUT_DIR"
