#!/usr/bin/env bash
set -euo pipefail

# Detect circular imports in TypeScript packages using madge.
# This is a codebase-wide check (not file-based) since cycles can span multiple packages.

cd "$(dirname "$0")/.."

# Run madge on all packages with TypeScript sources
output=$(npx madge --circular --extensions ts,tsx packages/*/src 2>/dev/null)

# Check if any cycles were found (madge outputs cycle info after the "Processed" line)
if echo "$output" | grep -q "Circular"; then
  echo "Error: circular imports detected in the codebase." >&2
  echo "" >&2
  echo "$output" | grep -A 1000 "Circular" >&2
  exit 1
fi

exit 0
