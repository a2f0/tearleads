#!/bin/sh
set -e

# Build iOS image assets from SVG source
# Requires: ImageMagick (brew install imagemagick)

# Timing helper
start_time=$(date +%s)
section_start() {
    section_time=$(date +%s)
}
section_end() {
    section_elapsed=$(($(date +%s) - section_time))
    echo "  (${section_elapsed}s)"
}

# Get script directory (POSIX compatible)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
SVG_SOURCE="$CLIENT_DIR/src/images/tearleads-logo-small.svg"
ASSETS_DIR="$CLIENT_DIR/ios/App/App/Assets.xcassets"

# Colors
BACKGROUND_COLOR="#FFFFFF"

# Check for ImageMagick (magick for v7+, convert for v6)
if command -v magick > /dev/null 2>&1; then
    MAGICK_CMD="magick"
elif command -v convert > /dev/null 2>&1; then
    MAGICK_CMD="convert"
else
    echo "Error: ImageMagick is required."
    echo "  macOS: brew install imagemagick"
    echo "  Linux: sudo apt-get install imagemagick"
    exit 1
fi

# Check for source SVG
if [ ! -f "$SVG_SOURCE" ]; then
    echo "Error: Source SVG not found at $SVG_SOURCE"
    exit 1
fi

echo "Generating iOS images from $SVG_SOURCE"

# Generate app icon (1024x1024 for iOS)
generate_app_icon() {
    dir="$ASSETS_DIR/AppIcon.appiconset"
    mkdir -p "$dir"

    size=1024
    icon_size=$((size * 70 / 100))

    # SVG viewBox is ~33px, calculate density to render larger than target, then downscale
    # density = (target_size / svg_size) * 72
    density=$((icon_size * 72 / 33))

    # AppIcon-512@2x.png - 1024x1024 (the @2x naming is iOS convention)
    # Apple requires: no alpha channel, sRGB color space, 8-bit depth
    # png:color-type=2 forces RGB output even for grayscale content
    $MAGICK_CMD -background "$BACKGROUND_COLOR" -density "$density" "$SVG_SOURCE" \
        -resize "${icon_size}x${icon_size}" \
        -gravity center -extent "${size}x${size}" \
        -alpha remove -alpha off \
        -depth 8 -colorspace sRGB -type TrueColor \
        -define png:color-type=2 \
        "$dir/AppIcon-512@2x.png"
    echo "  Created $dir/AppIcon-512@2x.png (${size}x${size})"
}

# Generate splash screen (2732x2732 for iOS)
generate_splash() {
    dir="$ASSETS_DIR/Splash.imageset"
    mkdir -p "$dir"

    size=2732
    logo_size=$((size * 35 / 100))

    # SVG viewBox is ~33px, calculate density to render at exact target size
    density=$((logo_size * 72 / 33))

    # All three scales use the same 2732x2732 size
    # Ensure sRGB color space for iOS compatibility
    # png:color-type=2 forces RGB output even for grayscale content
    $MAGICK_CMD -density "$density" -background "$BACKGROUND_COLOR" "$SVG_SOURCE" \
        -gravity center -extent "${size}x${size}" \
        -depth 8 -colorspace sRGB -type TrueColor \
        -define png:color-type=2 \
        "$dir/splash-2732x2732.png"
    echo "  Created $dir/splash-2732x2732.png (${size}x${size})"

    # Copy for 1x and 2x scales (iOS requires separate files)
    cp "$dir/splash-2732x2732.png" "$dir/splash-2732x2732-1.png"
    echo "  Created $dir/splash-2732x2732-1.png (${size}x${size})"

    cp "$dir/splash-2732x2732.png" "$dir/splash-2732x2732-2.png"
    echo "  Created $dir/splash-2732x2732-2.png (${size}x${size})"
}

# Generate app icon
echo "Generating app icon..."
section_start
generate_app_icon
section_end

# Generate splash screens
echo "Generating splash screens..."
section_start
generate_splash
section_end

total_time=$(($(date +%s) - start_time))
echo ""
echo "Done! Generated all iOS image assets in ${total_time}s."
echo ""
echo "To update your iOS project, run:"
echo "  cd $CLIENT_DIR && pnpm cap:sync"
