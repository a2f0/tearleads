#!/bin/sh
set -e

# Build app-web image assets into the build output directory.
#
# Sourced from the shared brand logo in @tearleads/ui and generated straight
# into dist/ (gitignored) so the deploy rsync ships them and the service
# worker can precache them. Run after the dist bundle exists.
#
# The favicon <link> tags are injected into dist/index.html here rather than
# kept in src/index.html: Bun's HTML bundler tries to resolve root-absolute
# asset paths (/favicon.svg etc.) at build time and fails when they do not
# exist yet.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"

SVG_SOURCE="$REPO_ROOT/packages/ui/assets/logo.svg"
OUTPUT_DIR="$PACKAGE_DIR/dist"
INDEX_HTML="$OUTPUT_DIR/index.html"

"$REPO_ROOT/scripts/buildFaviconImages.sh" "$SVG_SOURCE" "$OUTPUT_DIR"

if command -v magick > /dev/null 2>&1; then
  MAGICK_CMD="magick"
elif command -v convert > /dev/null 2>&1; then
  MAGICK_CMD="convert"
else
  echo "Error: ImageMagick is required (magick or convert command)." >&2
  exit 1
fi

# 44px transparent target image for compact mobile menu affordances. The logo
# itself is rendered at 28px and centered within the tap target, matching the
# routed app bar sizing while leaving enough padding for touch interaction.
MENU_ICON_SIZE=44
MENU_LOGO_SIZE=28
MENU_ICON_OUTPUT="$OUTPUT_DIR/tearleads-menu-icon-44.png"

$MAGICK_CMD -background none -density 288 "$SVG_SOURCE" \
  -resize "${MENU_LOGO_SIZE}x${MENU_LOGO_SIZE}" \
  -background none -gravity center -extent "${MENU_ICON_SIZE}x${MENU_ICON_SIZE}" \
  -depth 8 -colorspace sRGB -type TrueColorAlpha \
  "$MENU_ICON_OUTPUT"
echo "  Created $MENU_ICON_OUTPUT (${MENU_ICON_SIZE}x${MENU_ICON_SIZE})"

if [ ! -f "$INDEX_HTML" ]; then
  echo "Error: $INDEX_HTML not found; run the bundle build first." >&2
  exit 1
fi

FAVICON_INDEX="$INDEX_HTML" bun -e '
const file = process.env.FAVICON_INDEX;
const html = await Bun.file(file).text();
if (html.includes("/favicon.svg")) process.exit(0);
const links =
  "<link rel=\"icon\" href=\"/favicon.ico\" sizes=\"any\" />" +
  "<link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\" />" +
  "<link rel=\"apple-touch-icon\" href=\"/apple-touch-icon.png\" />";
const out = html.replace(/<\/head>/i, links + "</head>");
if (out === html) throw new Error("No </head> found in " + file);
await Bun.write(file, out);
'

echo "  Injected favicon links into $INDEX_HTML"
