#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
PACKAGE_DIR="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PACKAGE_DIR/build"

cd "$PACKAGE_DIR"
NODE_ENV=production bun run build

ARTIFACT_PATH="$(
  find "$BUILD_DIR" -type f \( \
    -path "*/Contents/MacOS/launcher" -o \
    -path "*/bin/launcher" -o \
    -name "*.exe" \
  \) -exec ls -td {} + 2>/dev/null | sed -n '1p'
)"

if [ -z "$ARTIFACT_PATH" ]; then
  echo "No executable build artifact found in $BUILD_DIR." >&2
  exit 1
fi

printf 'Executable build artifact: %s\n' "$ARTIFACT_PATH"
