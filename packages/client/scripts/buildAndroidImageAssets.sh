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
SVG_SOURCE="$CLIENT_DIR/../ui/src/images/logo.svg"
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

# Generate adaptive icon foreground vector drawable from SVG
generate_foreground_vector() {
    output_file="$RES_DIR/drawable/ic_launcher_foreground.xml"
    mkdir -p "$(dirname "$output_file")"

    # Adaptive icon is 108dp with 66dp safe zone, but circular icons need smaller content.
    # Target 50dp logo (inscribed in 66dp safe zone circle), centered with 29dp offset.
    # Use integer math: multiply by 50, divide by 33 (SVG viewBox size)
    target_size=50
    svg_size=33
    offset=$(( (108 - target_size) / 2 ))

    cat > "$output_file" << 'HEADER'
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
HEADER

    # Parse SVG rects and convert to Android vector paths
    # SVG format: <rect x="X" y="Y" width="W" height="H" fill="COLOR"/>
    grep '<rect' "$SVG_SOURCE" | while read -r line; do
        x=$(echo "$line" | sed -n 's/.*x="\([^"]*\)".*/\1/p')
        y=$(echo "$line" | sed -n 's/.*y="\([^"]*\)".*/\1/p')
        w=$(echo "$line" | sed -n 's/.*width="\([^"]*\)".*/\1/p')
        h=$(echo "$line" | sed -n 's/.*height="\([^"]*\)".*/\1/p')
        fill=$(echo "$line" | sed -n 's/.*fill="\([^"]*\)".*/\1/p')

        # Scale and offset for adaptive icon circular safe zone
        nx=$((x * target_size / svg_size + offset))
        ny=$((y * target_size / svg_size + offset))
        nw=$((w * target_size / svg_size))
        nh=$((h * target_size / svg_size))

        # Convert fill color to Android format (#RGB -> #FFRRGGBB, #RRGGBB -> #FFRRGGBB)
        if echo "$fill" | grep -qE '^#[0-9A-Fa-f]{3}$'; then
            # Expand 3-char hex: #RGB -> #RRGGBB
            r=$(echo "$fill" | cut -c2)
            g=$(echo "$fill" | cut -c3)
            b=$(echo "$fill" | cut -c4)
            android_color="#FF${r}${r}${g}${g}${b}${b}"
        else
            # 6-char hex: #RRGGBB -> #FFRRGGBB
            android_color=$(echo "$fill" | sed 's/#/#FF/')
        fi
        android_color=$(echo "$android_color" | tr '[:lower:]' '[:upper:]')

        cat >> "$output_file" << EOF
    <path
        android:fillColor="$android_color"
        android:pathData="M$nx,$ny h$nw v$nh h-$nw z" />
EOF
    done

    echo '</vector>' >> "$output_file"
    echo "  Created $output_file"
}

# Generate launcher icon
generate_launcher() {
    density=$1
    size=$2
    dir="$RES_DIR/mipmap-$density"
    mkdir -p "$dir"

    icon_size=$((size * 70 / 100))
    round_size=$((size * 50 / 100))

    # ic_launcher.png - square icon with padding
    $MAGICK_CMD -background "$BACKGROUND_COLOR" -density 300 "$SVG_SOURCE" \
        -resize "${icon_size}x${icon_size}" \
        -gravity center -extent "${size}x${size}" \
        "$dir/ic_launcher.png"
    echo "  Created $dir/ic_launcher.png (${size}x${size})"

    # ic_launcher_round.png - same as square for now (adaptive icons handle the shape)
    $MAGICK_CMD -background "$BACKGROUND_COLOR" -density 300 "$SVG_SOURCE" \
        -resize "${round_size}x${round_size}" \
        -gravity center -extent "${size}x${size}" \
        "$dir/ic_launcher_round.png"
    echo "  Created $dir/ic_launcher_round.png (${size}x${size})"
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

# Generate foreground vector drawable (for adaptive icons)
echo "Generating foreground vector drawable..."
section_start
generate_foreground_vector
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
