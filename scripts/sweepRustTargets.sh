#!/usr/bin/env bash
set -euo pipefail

# Sweep stale Rust build artifacts (older than 7 days) from this workspace.
# Requires: cargo-sweep (installed via mise)

DAYS="${1:-7}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

if ! command -v cargo-sweep &>/dev/null; then
  echo "ERROR: cargo-sweep not found. Run 'mise install' first." >&2
  exit 1
fi

if [ ! -f "$REPO_ROOT/Cargo.toml" ] || [ ! -d "$REPO_ROOT/target" ]; then
  echo "No Cargo workspace or target/ directory found; nothing to sweep."
  exit 0
fi

echo "Sweeping $REPO_ROOT (artifacts older than ${DAYS}d)..."
(cd "$REPO_ROOT" && cargo sweep --time "$DAYS")
