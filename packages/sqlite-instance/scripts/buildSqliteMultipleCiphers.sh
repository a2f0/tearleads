#!/bin/sh
set -eu

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PACKAGE_DIR/dist"

SQLITE3MC_VERSION="2.5.1"
SQLITE_VERSION="3.53.4"
SQLITE_VERSION_NUMBER="3530400"
ARCHIVE_SHA256="761a41b8dc996cfa21f193fc044739fbb0c4a31a1fd657a4df49cc59085577ce"

ARCHIVE_NAME="sqlite3mc-${SQLITE3MC_VERSION}-sqlite-${SQLITE_VERSION}-wasm.zip"
ARCHIVE_URL="https://github.com/utelle/SQLite3MultipleCiphers/releases/download/v${SQLITE3MC_VERSION}/${ARCHIVE_NAME}"
EXTRACTED_DIR="sqlite3mc-wasm-${SQLITE_VERSION_NUMBER}"

VERSION_STAMP="$DIST_DIR/.sqlite3mc-version"
if [ -f "$DIST_DIR/jswasm/sqlite3.wasm" ] &&
  [ -f "$VERSION_STAMP" ] &&
  [ "$(cat "$VERSION_STAMP")" = "$ARCHIVE_NAME" ]; then
  echo "sqlite3.wasm already exists in $DIST_DIR/jswasm, skipping download."
  exit 0
fi

WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

echo "Downloading ${ARCHIVE_NAME}..."
curl -fsSL -o "$WORK_DIR/$ARCHIVE_NAME" "$ARCHIVE_URL"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$WORK_DIR/$ARCHIVE_NAME" |
  shasum -a 256 -c -

echo "Extracting..."
unzip -q "$WORK_DIR/$ARCHIVE_NAME" -d "$WORK_DIR"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

cp -r "$WORK_DIR/$EXTRACTED_DIR/jswasm" "$DIST_DIR/jswasm"
printf '%s\n' "$ARCHIVE_NAME" > "$VERSION_STAMP"

echo "Build complete: $DIST_DIR/jswasm"
ls -lh "$DIST_DIR/jswasm/"
