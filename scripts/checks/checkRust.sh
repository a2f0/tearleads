#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --staged | --from-upstream | --all" >&2
  exit 2
}

if [ "$#" -ne 1 ]; then
  usage
fi

mode="$1"

collect_files() {
  if [ "$mode" = "--staged" ]; then
    git diff --name-only --diff-filter=AM --cached
    return
  fi

  if [ "$mode" = "--from-upstream" ]; then
    local base_branch

    if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
      base_branch="$upstream"
    elif git rev-parse --verify origin/main >/dev/null 2>&1; then
      base_branch="origin/main"
    elif git rev-parse --verify main >/dev/null 2>&1; then
      base_branch="main"
    else
      echo "Error: cannot determine base branch for comparison" >&2
      exit 1
    fi

    git diff --name-only --diff-filter=AM "$base_branch..HEAD"
    return
  fi

  if [ "$mode" = "--all" ]; then
    return
  fi

  usage
}

has_rust_changes() {
  local path
  for path in "$@"; do
    if [[ "$path" == Cargo.toml || "$path" == Cargo.lock || "$path" == rust-toolchain.toml || "$path" == clippy.toml || "$path" == rustfmt.toml || "$path" == deny.toml || "$path" == .cargo/* || "$path" == crates/* ]]; then
      return 0
    fi
  done
  return 1
}

if ! command -v cargo >/dev/null 2>&1; then
  echo "Error: cargo is required. Install Rust toolchain and retry." >&2
  exit 1
fi

if [ "$mode" != "--all" ]; then
  mapfile -t files < <(collect_files)
  if [ "${#files[@]}" -eq 0 ]; then
    exit 0
  fi

  if ! has_rust_changes "${files[@]}"; then
    exit 0
  fi
fi

if ! cargo llvm-cov --version >/dev/null 2>&1; then
  echo "Error: cargo-llvm-cov is required for Rust coverage enforcement." >&2
  echo "Install it with: cargo install cargo-llvm-cov" >&2
  exit 1
fi

if ! cargo deny --version >/dev/null 2>&1; then
  echo "Error: cargo-deny is required for supply-chain security checks." >&2
  echo "Install it with: cargo install cargo-deny" >&2
  exit 1
fi

if ! cargo machete --version >/dev/null 2>&1; then
  echo "Error: cargo-machete is required for unused dependency detection." >&2
  echo "Install it with: cargo install cargo-machete" >&2
  exit 1
fi

cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo deny check
cargo machete
cargo test --workspace --all-targets --all-features
if ! rustup target list --installed | grep -qx 'wasm32-unknown-unknown'; then
  rustup target add wasm32-unknown-unknown
fi
cargo check -p tearleads-api-client-wasm --target wasm32-unknown-unknown
cargo check -p tearleads-api-domain-wasm --target wasm32-unknown-unknown
cargo llvm-cov --package tearleads-api-v2 --lib --tests --ignore-filename-regex '(src/main.rs|postgres_gateway/)' --fail-under-lines 100 --summary-only
cargo llvm-cov --package tearleads-api-v2-ping-wasm --lib --tests --fail-under-lines 100 --summary-only
