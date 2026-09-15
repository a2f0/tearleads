#!/usr/bin/env bash
set -euo pipefail
# The checkout holding this script, whatever the caller's directory or GIT_*.
REPO_ROOT="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
ICONSET="$REPO_ROOT/packages/app-electrobun/build/release-icons/icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  for scale in 1 2; do
    pixels=$((size * scale))
    suffix=""
    [[ "$scale" -ne 2 ]] || suffix=@2x
    # Rasterize the 33px SVG above the largest (1024px) icon before resizing.
    magick -density 3072 -background none "$REPO_ROOT/packages/ui/assets/logo.svg" \
      -resize "${pixels}x${pixels}" \
      "$ICONSET/icon_${size}x${size}${suffix}.png"
  done
done
