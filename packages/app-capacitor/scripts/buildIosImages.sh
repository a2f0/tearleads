#!/bin/sh
set -e

# Build iOS image assets from SVG source
# Requires: ImageMagick

start_time=$(date +%s)
section_start() { section_time=$(date +%s); }
section_end() {
  section_elapsed=$(($(date +%s) - section_time))
  echo "  (${section_elapsed}s)"
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
SVG_SOURCE="$PACKAGE_DIR/assets/logo.svg"
ASSETS_DIR="$PACKAGE_DIR/ios/App/App/Assets.xcassets"

BACKGROUND_COLOR="#FFFFFF"

if command -v magick > /dev/null 2>&1; then
  MAGICK_CMD="magick"
elif command -v convert > /dev/null 2>&1; then
  MAGICK_CMD="convert"
else
  echo "Error: ImageMagick is required (magick or convert command)."
  exit 1
fi

if [ ! -f "$SVG_SOURCE" ]; then
  echo "Error: Source SVG not found at $SVG_SOURCE"
  exit 1
fi

echo "Generating iOS images from $SVG_SOURCE"

generate_app_icon() {
  dir="$ASSETS_DIR/AppIcon.appiconset"
  mkdir -p "$dir"

  size=1024
  icon_size=$((size * 70 / 100))
  density=$((icon_size * 72 / 33))

  $MAGICK_CMD -background "$BACKGROUND_COLOR" -density "$density" "$SVG_SOURCE" \
    -resize "${icon_size}x${icon_size}" \
    -gravity center -extent "${size}x${size}" \
    -alpha remove -alpha off \
    -depth 8 -colorspace sRGB -type TrueColor \
    -define png:color-type=2 \
    "$dir/AppIcon-512@2x.png"
  echo "  Created $dir/AppIcon-512@2x.png (${size}x${size})"
}

generate_splash() {
  dir="$ASSETS_DIR/Splash.imageset"
  mkdir -p "$dir"

  size=2732
  logo_size=$((size * 35 / 100))
  density=$((logo_size * 72 / 33))

  $MAGICK_CMD -density "$density" -background "$BACKGROUND_COLOR" "$SVG_SOURCE" \
    -gravity center -extent "${size}x${size}" \
    -depth 8 -colorspace sRGB -type TrueColor \
    -define png:color-type=2 \
    "$dir/splash@3x.png"
  echo "  Created $dir/splash@3x.png (${size}x${size})"

  cp "$dir/splash@3x.png" "$dir/splash@2x.png"
  echo "  Created $dir/splash@2x.png (${size}x${size})"

  cp "$dir/splash@3x.png" "$dir/splash.png"
  echo "  Created $dir/splash.png (${size}x${size})"
}

echo "Generating app icon..."
section_start
generate_app_icon
section_end

echo "Generating splash screens..."
section_start
generate_splash
section_end

total_time=$(($(date +%s) - start_time))
echo ""
echo "Done! Generated all iOS image assets in ${total_time}s."
