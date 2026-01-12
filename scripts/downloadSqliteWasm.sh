#!/bin/sh
#
# Downloads pre-built SQLite3MultipleCiphers WASM with encryption support.
#

set -e

SQLITE3MC_VERSION="2.2.6"
SQLITE_VERSION="3.51.1"
PACKAGE_NAME="sqlite3mc-${SQLITE3MC_VERSION}-sqlite-${SQLITE_VERSION}-wasm.zip"
DOWNLOAD_URL="https://github.com/utelle/SQLite3MultipleCiphers/releases/download/v${SQLITE3MC_VERSION}/${PACKAGE_NAME}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLIENT_DIR="${PROJECT_ROOT}/packages/client"
WASM_DIR="${CLIENT_DIR}/src/workers/sqlite-wasm"
PUBLIC_DIR="${CLIENT_DIR}/public/sqlite"
TEMP_DIR="${PROJECT_ROOT}/.tmp-sqlite-wasm"

cleanup() {
    rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

# Check if already downloaded
if [ -f "${WASM_DIR}/sqlite3.wasm" ] && [ "$1" != "--clean" ]; then
    echo "SQLite WASM already exists. Use --clean to re-download."
    exit 0
fi

# Clean if requested
if [ "$1" = "--clean" ]; then
    rm -rf "${WASM_DIR}" "${PUBLIC_DIR}"
fi

echo "Downloading SQLite3MultipleCiphers WASM v${SQLITE3MC_VERSION}..."

mkdir -p "${TEMP_DIR}"
curl -fsSL "${DOWNLOAD_URL}" -o "${TEMP_DIR}/${PACKAGE_NAME}"
unzip -q "${TEMP_DIR}/${PACKAGE_NAME}" -d "${TEMP_DIR}"

EXTRACTED_DIR=$(find "${TEMP_DIR}" -maxdepth 1 -type d -name "sqlite3mc-wasm-*" | head -1)

mkdir -p "${WASM_DIR}" "${PUBLIC_DIR}"

# Copy files to both locations
# Note: sqlite3.mjs is renamed to sqlite3.js for Android WebView MIME type compatibility
# Android WebView strictly enforces MIME type checking for ES modules, and .mjs files
# may not be served with text/javascript MIME type on all devices.
# See: https://github.com/apache/cordova-android/issues/1142
for file in sqlite3.wasm sqlite3-opfs-async-proxy.js; do
    cp "${EXTRACTED_DIR}/jswasm/${file}" "${WASM_DIR}/"
    cp "${EXTRACTED_DIR}/jswasm/${file}" "${PUBLIC_DIR}/"
done
# Rename .mjs to .js for better WebView compatibility
cp "${EXTRACTED_DIR}/jswasm/sqlite3.mjs" "${WASM_DIR}/sqlite3.js"
cp "${EXTRACTED_DIR}/jswasm/sqlite3.mjs" "${PUBLIC_DIR}/sqlite3.js"

# Copy optional worker files
cp "${EXTRACTED_DIR}/jswasm/sqlite3-worker1-bundler-friendly.mjs" "${WASM_DIR}/" 2>/dev/null || true
cp "${EXTRACTED_DIR}/jswasm/sqlite3-worker1-promiser-bundler-friendly.mjs" "${WASM_DIR}/" 2>/dev/null || true

echo "SQLite WASM installed to ${WASM_DIR} and ${PUBLIC_DIR}"
