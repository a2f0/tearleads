#!/bin/sh
set -e

# Build web image assets from SVG source
# Requires: ImageMagick (brew install imagemagick), svgo (pnpm add -D svgo)

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
OUTPUT_DIR="$CLIENT_DIR/public/generated"

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

# Check for svgo
check_svgo() {
    if command -v svgo > /dev/null 2>&1; then
        SVGO_CMD="svgo"
    elif [ -x "$CLIENT_DIR/node_modules/.bin/svgo" ]; then
        SVGO_CMD="$CLIENT_DIR/node_modules/.bin/svgo"
    else
        echo "Error: svgo is required." >&2
        echo "  Run: pnpm --filter @rapid/client add -D svgo" >&2
        exit 1
    fi
}

# Check for source SVG
if [ ! -f "$SVG_SOURCE" ]; then
    echo "Error: Source SVG not found at $SVG_SOURCE" >&2
    exit 1
fi

check_svgo

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "Generating web images from $SVG_SOURCE"
echo "Output directory: $OUTPUT_DIR"
echo ""

# Generate optimized SVG favicon
generate_svg_favicon() {
    echo "Generating SVG favicon..."
    section_start

    # Copy and optimize SVG for use as favicon
    cp "$SVG_SOURCE" "$OUTPUT_DIR/favicon.svg"
    $SVGO_CMD --quiet "$OUTPUT_DIR/favicon.svg"

    size=$(wc -c < "$OUTPUT_DIR/favicon.svg" | tr -d ' ')
    echo "  Created favicon.svg (${size}B)"
    section_end
}

# Generate PNG favicons
generate_png_favicons() {
    echo "Generating PNG favicons..."
    section_start

    # Standard favicon sizes
    for size in 16 32 48; do
        $MAGICK_CMD -background none -density 300 "$SVG_SOURCE" \
            -resize "${size}x${size}" \
            "$OUTPUT_DIR/favicon-${size}x${size}.png"
        echo "  Created favicon-${size}x${size}.png"
    done

    # Apple touch icon (180x180 with background)
    $MAGICK_CMD -background "$BACKGROUND_COLOR" -density 300 "$SVG_SOURCE" \
        -resize "140x140" \
        -gravity center -extent "180x180" \
        "$OUTPUT_DIR/apple-touch-icon.png"
    echo "  Created apple-touch-icon.png (180x180)"

    # Android/Chrome icons
    for size in 192 512; do
        icon_size=$((size * 70 / 100))
        $MAGICK_CMD -background "$BACKGROUND_COLOR" -density 300 "$SVG_SOURCE" \
            -resize "${icon_size}x${icon_size}" \
            -gravity center -extent "${size}x${size}" \
            "$OUTPUT_DIR/icon-${size}x${size}.png"
        echo "  Created icon-${size}x${size}.png"
    done

    section_end
}

# Generate ICO file (multi-resolution)
generate_ico() {
    echo "Generating ICO file..."
    section_start

    # Create ICO with multiple sizes
    $MAGICK_CMD \
        "$OUTPUT_DIR/favicon-16x16.png" \
        "$OUTPUT_DIR/favicon-32x32.png" \
        "$OUTPUT_DIR/favicon-48x48.png" \
        "$OUTPUT_DIR/favicon.ico"
    echo "  Created favicon.ico (16x16, 32x32, 48x48)"

    section_end
}

# Generate web manifest
generate_manifest() {
    echo "Generating web manifest..."
    section_start

    cat > "$OUTPUT_DIR/site.webmanifest" << 'EOF'
{
  "name": "Tearleads",
  "short_name": "Tearleads",
  "icons": [
    {
      "src": "/generated/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/generated/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "theme_color": "#ffffff",
  "background_color": "#ffffff",
  "display": "standalone"
}
EOF
    echo "  Created site.webmanifest"

    section_end
}

# Run all generators
generate_svg_favicon
generate_png_favicons
generate_ico
generate_manifest

total_time=$(($(date +%s) - start_time))
echo ""
echo "Done! Generated all web image assets in ${total_time}s."
echo ""
echo "Add to your index.html <head>:"
echo '  <link rel="icon" type="image/svg+xml" href="/generated/favicon.svg">'
echo '  <link rel="icon" type="image/png" sizes="32x32" href="/generated/favicon-32x32.png">'
echo '  <link rel="icon" type="image/png" sizes="16x16" href="/generated/favicon-16x16.png">'
echo '  <link rel="apple-touch-icon" sizes="180x180" href="/generated/apple-touch-icon.png">'
echo '  <link rel="shortcut icon" href="/generated/favicon.ico">'
echo '  <link rel="manifest" href="/generated/site.webmanifest">'
