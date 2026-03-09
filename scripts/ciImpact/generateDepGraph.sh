#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd)
PM_SCRIPT="$REPO_ROOT/scripts/tooling/pm.sh"
DOT_OUTPUT="$SCRIPT_DIR/depGraph.dot"
SVG_OUTPUT="$SCRIPT_DIR/depGraph.svg"

cd "$REPO_ROOT"

sh "$PM_SCRIPT" exec depcruise --config .dependency-cruiser.json --output-type dot packages > "$DOT_OUTPUT"
echo "Wrote $DOT_OUTPUT"

if command -v dot >/dev/null 2>&1; then
  dot -Tsvg "$DOT_OUTPUT" -o "$SVG_OUTPUT"
  echo "Wrote $SVG_OUTPUT"
else
  echo "graphviz not found — skipping SVG generation (install with: brew install graphviz)"
fi
