#!/usr/bin/env bash
set -euo pipefail

# Sweep Rust build artifacts from this workspace to reclaim disk space.
# Uses --maxsize to cap the target/ directory.
# Requires: cargo-sweep (installed via mise)

if [[ "${1:-}" =~ ^- ]]; then
  echo "ERROR: Options are not supported. Provide a max size value (e.g. 10GB)." >&2
  exit 1
fi
MAX_SIZE="${1:-10GB}"

REPO_ROOT="$(git rev-parse --show-toplevel)"

if ! command -v cargo-sweep &>/dev/null; then
  echo "ERROR: cargo-sweep not found. Run 'mise install' first." >&2
  exit 1
fi

if [ ! -f "$REPO_ROOT/Cargo.toml" ] || [ ! -d "$REPO_ROOT/target" ]; then
  echo "No Cargo workspace or target/ directory found; nothing to sweep."
  exit 0
fi

echo "Sweeping $REPO_ROOT (maxsize ${MAX_SIZE})..."
(cd "$REPO_ROOT" && cargo sweep --maxsize "$MAX_SIZE")
