#!/bin/sh
set -e

# Build Android image assets from SVG source
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
RES_DIR="$CLIENT_DIR/android/app/src/main/res"

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

echo "Generating Android images from $SVG_SOURCE"

# Generate launcher icon
generate_launcher() {
    density=$1
    size=$2
    dir="$RES_DIR/mipmap-$density"
    mkdir -p "$dir"

    icon_size=$((size * 70 / 100))
    round_size=$((size * 60 / 100))
    half=$((size / 2))

    # ic_launcher.png - square icon with padding
    $MAGICK_CMD -background "$BACKGROUND_COLOR" -density 300 "$SVG_SOURCE" \
        -resize "${icon_size}x${icon_size}" \
        -gravity center -extent "${size}x${size}" \
        "$dir/ic_launcher.png"
    echo "  Created $dir/ic_launcher.png (${size}x${size})"

    # ic_launcher_round.png - circular icon
    $MAGICK_CMD -background "$BACKGROUND_COLOR" -density 300 "$SVG_SOURCE" \
        -resize "${round_size}x${round_size}" \
        -gravity center -extent "${size}x${size}" \
        \( +clone -alpha extract \
           -draw "fill black polygon 0,0 0,${size} ${size},0 fill white circle ${half},${half} ${half},0" \
           -alpha off \) \
        -compose CopyOpacity -composite \
        "$dir/ic_launcher_round.png"
    echo "  Created $dir/ic_launcher_round.png (${size}x${size})"
}

# Generate foreground icon
generate_foreground() {
    density=$1
    size=$2
    dir="$RES_DIR/mipmap-$density"
    mkdir -p "$dir"

    fg_size=$((size * 50 / 100))

    # ic_launcher_foreground.png - logo centered with safe zone padding
    $MAGICK_CMD -background none -density 300 "$SVG_SOURCE" \
        -resize "${fg_size}x${fg_size}" \
        -gravity center -extent "${size}x${size}" \
        "$dir/ic_launcher_foreground.png"
    echo "  Created $dir/ic_launcher_foreground.png (${size}x${size})"
}

# Generate splash screen
generate_splash() {
    folder=$1
    width=$2
    height=$3
    dir="$RES_DIR/$folder"
    mkdir -p "$dir"

    # Calculate logo size (roughly 35% of smaller dimension)
    if [ "$width" -lt "$height" ]; then
        smaller=$width
    else
        smaller=$height
    fi
    logo_size=$((smaller * 35 / 100))

    # Create splash with centered logo
    # SVG viewBox is ~33px, calculate density to render at exact target size
    # density = (target_size / svg_size) * 72
    density=$((logo_size * 72 / 33))

    $MAGICK_CMD -density "$density" -background none "$SVG_SOURCE" \
        -background "$BACKGROUND_COLOR" -gravity center -extent "${width}x${height}" \
        "$dir/splash.png"
    echo "  Created $dir/splash.png (${width}x${height})"
}

# Generate launcher icons
echo "Generating launcher icons..."
section_start
generate_launcher "mdpi" 48
generate_launcher "hdpi" 72
generate_launcher "xhdpi" 96
generate_launcher "xxhdpi" 144
generate_launcher "xxxhdpi" 192
section_end

# Generate foreground icons (for adaptive icons)
echo "Generating foreground icons..."
section_start
generate_foreground "mdpi" 108
generate_foreground "hdpi" 162
generate_foreground "xhdpi" 216
generate_foreground "xxhdpi" 324
generate_foreground "xxxhdpi" 432
section_end

# Generate splash screens
echo "Generating splash screens..."
section_start
generate_splash "drawable" 480 320
generate_splash "drawable-land-mdpi" 480 320
generate_splash "drawable-land-hdpi" 800 480
generate_splash "drawable-land-xhdpi" 1280 720
generate_splash "drawable-land-xxhdpi" 1600 960
generate_splash "drawable-land-xxxhdpi" 1920 1280
generate_splash "drawable-port-mdpi" 320 480
generate_splash "drawable-port-hdpi" 480 800
generate_splash "drawable-port-xhdpi" 720 1280
generate_splash "drawable-port-xxhdpi" 960 1600
generate_splash "drawable-port-xxxhdpi" 1280 1920
section_end

total_time=$(($(date +%s) - start_time))
echo ""
echo "Done! Generated all Android image assets in ${total_time}s."
echo ""
echo "To update your Android project, run:"
echo "  cd $CLIENT_DIR && pnpm cap:sync"
