#!/bin/sh
set -eu

# Bundle analyzer script - generates visual reports of JavaScript bundle composition
# Output: packages/client/dist/stats.html (opens automatically)

cd "$(dirname "$0")/.."

echo "Building with bundle analyzer..."
ANALYZE_BUNDLE=true pnpm --filter @rapid/client build

STATS_FILE="packages/client/dist/stats.html"
if [ -f "$STATS_FILE" ]; then
  echo "Opening bundle analysis report..."
  open "$STATS_FILE"
else
  echo "Error: stats.html not found at $STATS_FILE"
  exit 1
fi
