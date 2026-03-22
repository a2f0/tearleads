#!/usr/bin/env bash
set -euo pipefail

CRATE_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$CRATE_DIR/pkg"
TARGET="wasm32-unknown-unknown"

cargo build -p http-client-wasm --target "$TARGET" --release

wasm-bindgen --target web --out-dir "$OUT_DIR" \
  "$CRATE_DIR/../target/$TARGET/release/http_client_wasm.wasm"

wasm-opt -Os --enable-bulk-memory-opt \
  "$OUT_DIR/http_client_wasm_bg.wasm" \
  -o "$OUT_DIR/http_client_wasm_bg.wasm"
