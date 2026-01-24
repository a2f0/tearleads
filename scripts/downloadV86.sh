#!/bin/sh
#
# Downloads v86 emulator files (libv86.js, v86.wasm, BIOS files).
# These files are not committed to the repo to reduce size.
#

set -e
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

V86_RELEASE_URL="https://github.com/copy/v86/releases/download/latest"
V86_BIOS_URL="https://github.com/copy/v86/raw/master/bios"

PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
V86_DIR="${PROJECT_ROOT}/packages/client/public/v86"

# Check if already downloaded
if [ -f "${V86_DIR}/v86.wasm" ] && [ "$1" != "--clean" ]; then
    echo "v86 files already exist. Use --clean to re-download."
    exit 0
fi

# Clean if requested
if [ "$1" = "--clean" ]; then
    echo "Cleaning existing v86 files..."
    rm -rf "${V86_DIR}"
fi

echo "Downloading v86 emulator files..."

mkdir -p "${V86_DIR}"

# Download from v86 releases
for file in libv86.js v86.wasm; do
    echo "  Downloading ${file}..."
    curl -fsSL "${V86_RELEASE_URL}/${file}" -o "${V86_DIR}/${file}"
done

# Download BIOS files from v86 repo
for file in seabios.bin vgabios.bin; do
    echo "  Downloading ${file}..."
    curl -fsSL "${V86_BIOS_URL}/${file}" -o "${V86_DIR}/${file}"
done

echo "v86 files installed to ${V86_DIR}"
