#!/bin/sh
set -e

# Build Android image assets from SVG source
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
RES_DIR="$PACKAGE_DIR/android/app/src/main/res"

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

echo "Generating Android images from $SVG_SOURCE"

generate_foreground_vector() {
  output_file="$RES_DIR/drawable/ic_launcher_foreground.xml"
  mkdir -p "$(dirname "$output_file")"

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

  grep '<rect' "$SVG_SOURCE" | while read -r line; do
    x=$(echo "$line" | sed -n 's/.*x="\([^"]*\)".*/\1/p')
    y=$(echo "$line" | sed -n 's/.*y="\([^"]*\)".*/\1/p')
    w=$(echo "$line" | sed -n 's/.*width="\([^"]*\)".*/\1/p')
    h=$(echo "$line" | sed -n 's/.*height="\([^"]*\)".*/\1/p')
    fill=$(echo "$line" | sed -n 's/.*fill="\([^"]*\)".*/\1/p')

    nx=$((x * target_size / svg_size + offset))
    ny=$((y * target_size / svg_size + offset))
    nw=$((w * target_size / svg_size))
    nh=$((h * target_size / svg_size))

    if echo "$fill" | grep -qE '^#[0-9A-Fa-f]{3}$'; then
      r=$(echo "$fill" | cut -c2)
      g=$(echo "$fill" | cut -c3)
      b=$(echo "$fill" | cut -c4)
      android_color="#FF${r}${r}${g}${g}${b}${b}"
    else
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

generate_launcher() {
  density=$1
  size=$2
  dir="$RES_DIR/mipmap-$density"
  mkdir -p "$dir"

  icon_size=$((size * 70 / 100))
  round_size=$((size * 50 / 100))

  $MAGICK_CMD -background "$BACKGROUND_COLOR" -density 300 "$SVG_SOURCE" \
    -resize "${icon_size}x${icon_size}" \
    -gravity center -extent "${size}x${size}" \
    "$dir/ic_launcher.png"
  echo "  Created $dir/ic_launcher.png (${size}x${size})"

  $MAGICK_CMD -background "$BACKGROUND_COLOR" -density 300 "$SVG_SOURCE" \
    -resize "${round_size}x${round_size}" \
    -gravity center -extent "${size}x${size}" \
    "$dir/ic_launcher_round.png"
  echo "  Created $dir/ic_launcher_round.png (${size}x${size})"

  $MAGICK_CMD -background "$BACKGROUND_COLOR" -density 300 "$SVG_SOURCE" \
    -resize "${size}x${size}" \
    -gravity center -extent "${size}x${size}" \
    "$dir/ic_launcher_foreground.png"
  echo "  Created $dir/ic_launcher_foreground.png (${size}x${size})"
}

generate_splash() {
  folder=$1
  width=$2
  height=$3
  dir="$RES_DIR/$folder"
  mkdir -p "$dir"

  if [ "$width" -lt "$height" ]; then
    smaller=$width
  else
    smaller=$height
  fi
  logo_size=$((smaller * 35 / 100))

  density=$((logo_size * 72 / 33))

  $MAGICK_CMD -density "$density" -background none "$SVG_SOURCE" \
    -background "$BACKGROUND_COLOR" -gravity center -extent "${width}x${height}" \
    "$dir/splash.png"
  echo "  Created $dir/splash.png (${width}x${height})"
}

echo "Generating launcher icons..."
section_start
generate_launcher "mdpi" 48
generate_launcher "hdpi" 72
generate_launcher "xhdpi" 96
generate_launcher "xxhdpi" 144
generate_launcher "xxxhdpi" 192
section_end

echo "Generating foreground vector drawable..."
section_start
generate_foreground_vector
section_end

echo "Generating splash screens..."
section_start
# The base drawable/splash is the committed drawable/splash.xml layer-list
# (binary-free). Do NOT generate drawable/splash.png here: it would define
# @drawable/splash twice in the same config folder and fail the aapt2 build
# with a duplicate-resource error. Only density/orientation-qualified splash
# PNGs (different config folders) are generated.
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
