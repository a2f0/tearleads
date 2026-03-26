#!/bin/sh
set -eu

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PACKAGE_DIR/dist"

SQLITE3MC_VERSION="2.3.2"
SQLITE_VERSION="3.51.3"
SQLITE_VERSION_NUMBER="3510300"

ARCHIVE_NAME="sqlite3mc-${SQLITE3MC_VERSION}-sqlite-${SQLITE_VERSION}-wasm.zip"
ARCHIVE_URL="https://github.com/utelle/SQLite3MultipleCiphers/releases/download/v${SQLITE3MC_VERSION}/${ARCHIVE_NAME}"
EXTRACTED_DIR="sqlite3mc-wasm-${SQLITE_VERSION_NUMBER}"

if [ -f "$DIST_DIR/jswasm/sqlite3.wasm" ]; then
  echo "sqlite3.wasm already exists in $DIST_DIR/jswasm, skipping download."
  exit 0
fi

WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

echo "Downloading ${ARCHIVE_NAME}..."
curl -sL -o "$WORK_DIR/$ARCHIVE_NAME" "$ARCHIVE_URL"

echo "Extracting..."
unzip -q "$WORK_DIR/$ARCHIVE_NAME" -d "$WORK_DIR"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

cp -r "$WORK_DIR/$EXTRACTED_DIR/jswasm" "$DIST_DIR/jswasm"

echo "Build complete: $DIST_DIR/jswasm"
ls -lh "$DIST_DIR/jswasm/"
