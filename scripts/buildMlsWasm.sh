#!/usr/bin/env bash
# Build MLS WASM module using wasm-pack
# This script is called during CI to build the OpenMLS WASM bindings

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
MLS_WASM_DIR="$ROOT_DIR/packages/mls-wasm"
OUTPUT_DIR="$ROOT_DIR/packages/client/public/mls"

echo "Building MLS WASM module..."

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "wasm-pack not found, installing..."
    curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "Error: Rust/Cargo is not installed. Please install Rust first."
    exit 1
fi

# Navigate to the MLS WASM crate
cd "$MLS_WASM_DIR"

# Build for web target
echo "Running wasm-pack build..."
wasm-pack build --target web --out-dir pkg --release

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Copy the built files to client public folder
echo "Copying WASM files to $OUTPUT_DIR..."
cp pkg/mls_wasm_bg.wasm "$OUTPUT_DIR/"
cp pkg/mls_wasm.js "$OUTPUT_DIR/"
cp pkg/mls_wasm.d.ts "$OUTPUT_DIR/"

# Also copy the package.json for type information
cp pkg/package.json "$OUTPUT_DIR/"

echo "MLS WASM build complete!"
echo "Output files:"
ls -la "$OUTPUT_DIR"
