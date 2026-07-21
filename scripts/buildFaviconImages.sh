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

# Render the logo centered at one size. `fill_percent` (default 80) sets how
# much of the canvas the logo spans: browser favicons fill the whole icon so
# the mark stays legible at 16px in a tab, while the apple-touch icon keeps a
# margin. With opaque=true the logo is flattened onto BACKGROUND_COLOR (required
# for the apple-touch icon, which does not support transparency); otherwise
# transparency is preserved so the icon adapts to light/dark browser tabs.
render_png() {
  size=$1
  output=$2
  opaque=${3:-false}
  fill_percent=${4:-80}

  logo_size=$((size * fill_percent / 100))
  density=$((logo_size * 72 / SVG_VIEWBOX))

  if [ "$opaque" = "true" ]; then
    $MAGICK_CMD -background none -density "$density" "$SVG_SOURCE" \
      -resize "${logo_size}x${logo_size}" \
      -background "$BACKGROUND_COLOR" -gravity center -extent "${size}x${size}" \
      -alpha remove -alpha off \
      -depth 8 -colorspace sRGB -type TrueColor \
      "$output"
  else
    $MAGICK_CMD -background none -density "$density" "$SVG_SOURCE" \
      -resize "${logo_size}x${logo_size}" \
      -background none -gravity center -extent "${size}x${size}" \
      -depth 8 -colorspace sRGB -type TrueColorAlpha \
      "$output"
  fi
}

# Legacy multi-resolution ICO: render a crisp transparent master that fills the
# canvas (matching favicon.svg), then pack 16/32/48 so the icon stays
# transparent (no white box in dark-mode tabs) and reads large in the tab.
ico_master="$OUTPUT_DIR/.favicon-master.png"
render_png 256 "$ico_master" false 100
$MAGICK_CMD "$ico_master" -define icon:auto-resize=48,32,16 "$OUTPUT_DIR/favicon.ico"
rm -f "$ico_master"
echo "  Created $OUTPUT_DIR/favicon.ico (16/32/48)"

# iOS / Safari home-screen icon (opaque; iOS does not support transparency).
render_png 180 "$OUTPUT_DIR/apple-touch-icon.png" true
echo "  Created $OUTPUT_DIR/apple-touch-icon.png (180x180)"

echo "Done."
