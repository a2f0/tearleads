#!/bin/sh
set -e

# Build web favicon assets from an SVG source.
#
# Usage: buildFaviconImages.sh <svg-source> <output-dir>
#
# Generates a modern SVG favicon plus raster fallbacks for browsers that do
# not yet support SVG icons:
#   favicon.svg         scalable icon (preferred by modern browsers)
#   favicon.ico         multi-resolution 16/32/48 fallback (and the implicit
#                       /favicon.ico browsers request when no link is present)
#   apple-touch-icon.png 180x180 home-screen icon for iOS/Safari
#
# Requires: ImageMagick (magick or convert).

SVG_SOURCE="$1"
OUTPUT_DIR="$2"

# The source logo uses a 33x33 viewBox; ImageMagick density is derived from it.
SVG_VIEWBOX=33
BACKGROUND_COLOR="${FAVICON_BACKGROUND:-#FFFFFF}"

if [ -z "$SVG_SOURCE" ] || [ -z "$OUTPUT_DIR" ]; then
  echo "Usage: $0 <svg-source> <output-dir>" >&2
  exit 2
fi

if command -v magick > /dev/null 2>&1; then
  MAGICK_CMD="magick"
elif command -v convert > /dev/null 2>&1; then
  MAGICK_CMD="convert"
else
  echo "Error: ImageMagick is required (magick or convert command)." >&2
  exit 1
fi

if [ ! -f "$SVG_SOURCE" ]; then
  echo "Error: Source SVG not found at $SVG_SOURCE" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "Generating favicons from $SVG_SOURCE into $OUTPUT_DIR"

# Modern browsers: serve the scalable SVG as-is.
cp "$SVG_SOURCE" "$OUTPUT_DIR/favicon.svg"
echo "  Created $OUTPUT_DIR/favicon.svg"

# Render the logo centered (with padding) on an opaque background at one size.
render_png() {
  size=$1
  output=$2

  logo_size=$((size * 80 / 100))
  density=$((logo_size * 72 / SVG_VIEWBOX))

  $MAGICK_CMD -background none -density "$density" "$SVG_SOURCE" \
    -resize "${logo_size}x${logo_size}" \
    -background "$BACKGROUND_COLOR" -gravity center -extent "${size}x${size}" \
    -alpha remove -alpha off \
    -depth 8 -colorspace sRGB -type TrueColor \
    "$output"
}

# Legacy multi-resolution ICO: render a crisp master, then pack 16/32/48.
ico_master="$OUTPUT_DIR/.favicon-master.png"
render_png 256 "$ico_master"
$MAGICK_CMD "$ico_master" -define icon:auto-resize=48,32,16 "$OUTPUT_DIR/favicon.ico"
rm -f "$ico_master"
echo "  Created $OUTPUT_DIR/favicon.ico (16/32/48)"

# iOS / Safari home-screen icon (no transparency).
render_png 180 "$OUTPUT_DIR/apple-touch-icon.png"
echo "  Created $OUTPUT_DIR/apple-touch-icon.png (180x180)"

echo "Done."
