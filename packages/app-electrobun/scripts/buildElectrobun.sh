#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
PACKAGE_DIR="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "$PACKAGE_DIR/../.." && pwd)"
BUILD_DIR="$PACKAGE_DIR/build"

cd "$PACKAGE_DIR"
NODE_ENV=production sh "$REPO_ROOT/scripts/withBuildInfoEnv.sh" \
  bun run electrobun build "$@"

if [ ! -d "$BUILD_DIR" ]; then
  echo "Build directory $BUILD_DIR does not exist. The build may have failed." >&2
  exit 1
fi

ARTIFACT_PATH="$(
  find "$BUILD_DIR" -type f \( \
    -path "*/Contents/MacOS/launcher" -o \
    -path "*/bin/launcher" -o \
    -name "*.exe" \
  \) -exec ls -td {} + 2>/dev/null | sed -n '1p'
)"

if [ -z "$ARTIFACT_PATH" ]; then
  echo "No build artifact found in $BUILD_DIR." >&2
  exit 1
elif [ ! -x "$ARTIFACT_PATH" ]; then
  echo "Build artifact found at $ARTIFACT_PATH is not executable." >&2
  exit 1
fi

bun scripts/packageElectrobunAssets.ts "$ARTIFACT_PATH"

printf 'Executable build artifact: %s\n' "$ARTIFACT_PATH"
