#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

TARGET_TRIPLE="wasm32-unknown-unknown"
BUILD_PROFILE="${BUILD_PROFILE:-release}"

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

# Auto-discover all *-wasm crates
CRATE_DIRS=()
for dir in "$REPO_ROOT"/crates/*-wasm; do
  if [[ -f "$dir/Cargo.toml" ]]; then
    CRATE_DIRS+=("$dir")
  fi
done

if [[ ${#CRATE_DIRS[@]} -eq 0 ]]; then
  echo "No *-wasm crates found in crates/." >&2
  exit 1
fi

# Collect cargo package names for the build invocation
PACKAGE_ARGS=()
for dir in "${CRATE_DIRS[@]}"; do
  pkg_name=$(grep '^name' "$dir/Cargo.toml" | head -1 | sed 's/.*"\(.*\)".*/\1/')
  PACKAGE_ARGS+=(--package "$pkg_name")
done

echo "Building ${#CRATE_DIRS[@]} WASM crate(s) for ${TARGET_TRIPLE} (${BUILD_PROFILE})..."
cargo build \
  --manifest-path "$REPO_ROOT/Cargo.toml" \
  "${PACKAGE_ARGS[@]}" \
  --target "$TARGET_TRIPLE" \
  --profile "$BUILD_PROFILE"

# Convert kebab-case directory name to camelCase
to_camel_case() {
  local input="$1"
  echo "$input" | awk -F'-' '{for(i=1;i<=NF;i++){if(i==1){printf "%s",$i}else{printf "%s",toupper(substr($i,1,1)) substr($i,2)}}}' && echo
}

for dir in "${CRATE_DIRS[@]}"; do
  crate_dir_name=$(basename "$dir")
  pkg_name=$(grep '^name' "$dir/Cargo.toml" | head -1 | sed 's/.*"\(.*\)".*/\1/')
  # wasm filename uses underscores (cargo convention)
  wasm_filename="${pkg_name//-/_}.wasm"
  wasm_input="$REPO_ROOT/target/$TARGET_TRIPLE/$BUILD_PROFILE/$wasm_filename"

  if [[ ! -f "$wasm_input" ]]; then
    echo "Error: expected wasm artifact not found at $wasm_input" >&2
    exit 1
  fi

  camel_name=$(to_camel_case "$crate_dir_name")

  OUTPUT_DIRS=(
    "$REPO_ROOT/packages/api-client/.generated/$camel_name"
    "$REPO_ROOT/packages/client/.generated/$camel_name"
    "$REPO_ROOT/packages/client/public/.generated/$camel_name"
  )

  for output_dir in "${OUTPUT_DIRS[@]}"; do
    rm -rf "$output_dir"
    mkdir -p "$output_dir"
    echo "Generating bindings in ${output_dir#"$REPO_ROOT"/}..."
    wasm-bindgen \
      "$wasm_input" \
      --target web \
      --out-dir "$output_dir" \
      --typescript
  done
done

echo "Generated WASM bindings successfully."
