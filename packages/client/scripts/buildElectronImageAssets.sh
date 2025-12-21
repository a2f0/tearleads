#!/bin/sh
set -e

# Build Electron image assets from SVG source
# Requires: ImageMagick (brew install imagemagick)
# macOS .icns generation requires iconutil (comes with Xcode Command Line Tools)

# Timing helper
start_time=$(date +%s)
section_start() {
    section_time=$(date +%s)
}
section_end() {
    section_elapsed=$(($(date +%s) - section_time))
    echo "  (${section_elapsed}s)"
}

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
SVG_SOURCE="$CLIENT_DIR/../ui/src/images/logo.svg"
OUTPUT_DIR="$CLIENT_DIR/build/icons"

# Colors
BACKGROUND_COLOR="#FFFFFF"

# Check for ImageMagick (magick for v7+, convert for v6)
if command -v magick > /dev/null 2>&1; then
    MAGICK_CMD="magick"
elif command -v convert > /dev/null 2>&1; then
    MAGICK_CMD="convert"
else
    echo "Error: ImageMagick is required." >&2
    echo "  macOS: brew install imagemagick" >&2
    echo "  Linux: sudo apt-get install imagemagick" >&2
    exit 1
fi

# Check for source SVG
if [ ! -f "$SVG_SOURCE" ]; then
    echo "Error: Source SVG not found at $SVG_SOURCE" >&2
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "Generating Electron icons from $SVG_SOURCE"
echo "Output directory: $OUTPUT_DIR"
echo ""

# Helper function to generate a PNG at a specific size with logo centered
generate_icon_png() {
    size=$1
    output_file=$2

    # Logo takes up 70% of the icon, centered on white background
    icon_size=$((size * 70 / 100))

    # SVG viewBox is ~33px, calculate density for quality rendering
    density=$((icon_size * 72 / 33))

    $MAGICK_CMD -background "$BACKGROUND_COLOR" -density "$density" "$SVG_SOURCE" \
        -resize "${icon_size}x${icon_size}" \
        -gravity center -extent "${size}x${size}" \
        "$output_file"
}

# Generate macOS .icns file
generate_macos_icns() {
    echo "Generating macOS .icns..."
    section_start

    # Check for iconutil (macOS only)
    if ! command -v iconutil > /dev/null 2>&1; then
        echo "  Warning: iconutil not available (macOS only). Skipping .icns generation."
        section_end
        return
    fi

    ICONSET_DIR="$OUTPUT_DIR/icon.iconset"
    mkdir -p "$ICONSET_DIR"

    # Generate all required iconset sizes
    # Format: icon_NxN.png and icon_NxN@2x.png
    for size in 16 32 128 256 512; do
        generate_icon_png "$size" "$ICONSET_DIR/icon_${size}x${size}.png"
        echo "    Created icon_${size}x${size}.png"

        # @2x versions
        double_size=$((size * 2))
        generate_icon_png "$double_size" "$ICONSET_DIR/icon_${size}x${size}@2x.png"
        echo "    Created icon_${size}x${size}@2x.png"
    done

    # Create .icns from iconset
    iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_DIR/icon.icns"
    echo "  Created icon.icns"

    # Clean up iconset directory
    rm -rf "$ICONSET_DIR"

    section_end
}

# Generate Windows .ico file
generate_windows_ico() {
    echo "Generating Windows .ico..."
    section_start

    TMP_DIR="$OUTPUT_DIR/tmp_ico"
    mkdir -p "$TMP_DIR"

    # Generate sizes for ICO (16, 24, 32, 48, 64, 128, 256)
    for size in 16 24 32 48 64 128 256; do
        generate_icon_png "$size" "$TMP_DIR/icon-${size}.png"
        echo "    Created ${size}x${size}"
    done

    # Combine into ICO file
    $MAGICK_CMD \
        "$TMP_DIR/icon-16.png" \
        "$TMP_DIR/icon-24.png" \
        "$TMP_DIR/icon-32.png" \
        "$TMP_DIR/icon-48.png" \
        "$TMP_DIR/icon-64.png" \
        "$TMP_DIR/icon-128.png" \
        "$TMP_DIR/icon-256.png" \
        "$OUTPUT_DIR/icon.ico"
    echo "  Created icon.ico"

    # Clean up temp directory
    rm -rf "$TMP_DIR"

    section_end
}

# Generate Linux PNG (512x512)
generate_linux_png() {
    echo "Generating Linux .png..."
    section_start

    generate_icon_png 512 "$OUTPUT_DIR/icon.png"
    echo "  Created icon.png (512x512)"

    section_end
}

# Run all generators
generate_macos_icns
generate_windows_ico
generate_linux_png

total_time=$(($(date +%s) - start_time))
echo ""
echo "Done! Generated all Electron icons in ${total_time}s."
echo ""
echo "Icons are referenced in electron-builder.config.ts"
