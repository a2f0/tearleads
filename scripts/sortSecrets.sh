#!/bin/sh
# Sort .secrets env files in-place.
# Works on both macOS (BSD) and GNU/Linux.

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for f in root.env staging.env prod.env; do
  target="$REPO_ROOT/.secrets/$f"
  if [ ! -f "$target" ]; then
    printf 'warning: %s not found, skipping\n' "$target" >&2
    continue
  fi
  sorted="$(sort "$target")"
  printf '%s\n' "$sorted" > "$target"
done
