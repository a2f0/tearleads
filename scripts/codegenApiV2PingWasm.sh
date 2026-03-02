#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

PACKAGE_NAME="tearleads-api-v2-ping-wasm"
TARGET_TRIPLE="wasm32-unknown-unknown"
BUILD_PROFILE="${BUILD_PROFILE:-release}"
OUTPUT_DIRS=(
  "$REPO_ROOT/packages/api-client/.generated/apiV2PingWasm"
  "$REPO_ROOT/packages/client/.generated/apiV2PingWasm"
)

if ! command -v cargo >/dev/null 2>&1; then
  echo "Error: cargo is required." >&2
  exit 1
fi

if ! command -v rustup >/dev/null 2>&1; then
  echo "Error: rustup is required to install ${TARGET_TRIPLE}." >&2
  exit 1
fi

if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo "Error: wasm-bindgen-cli is required." >&2
  echo "Install with: cargo install wasm-bindgen-cli" >&2
  exit 1
fi

if ! rustup target list --installed | grep -qx "$TARGET_TRIPLE"; then
  rustup target add "$TARGET_TRIPLE"
fi

echo "Building ${PACKAGE_NAME} for ${TARGET_TRIPLE} (${BUILD_PROFILE})..."
cargo build \
  --manifest-path "$REPO_ROOT/Cargo.toml" \
  --package "$PACKAGE_NAME" \
  --target "$TARGET_TRIPLE" \
  --profile "$BUILD_PROFILE"

WASM_FILENAME="tearleads_api_v2_ping_wasm.wasm"
WASM_INPUT="$REPO_ROOT/target/$TARGET_TRIPLE/$BUILD_PROFILE/$WASM_FILENAME"

if [ ! -f "$WASM_INPUT" ]; then
  echo "Error: expected wasm artifact not found at $WASM_INPUT" >&2
  exit 1
fi

for output_dir in "${OUTPUT_DIRS[@]}"; do
  rm -rf "$output_dir"
  mkdir -p "$output_dir"
  echo "Generating bindings in ${output_dir#"$REPO_ROOT"/}..."
  wasm-bindgen \
    "$WASM_INPUT" \
    --target bundler \
    --out-dir "$output_dir" \
    --typescript
done

echo "Generated API v2 ping wasm bindings successfully."
