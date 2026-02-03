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
  case "$(uname -s)" in
    Darwin)
      open "$STATS_FILE"
      ;;
    Linux)
      xdg-open "$STATS_FILE"
      ;;
    CYGWIN*|MINGW*|MSYS*)
      start "$STATS_FILE"
      ;;
    *)
      echo "Unsupported OS for opening file automatically. Please open '$STATS_FILE' manually."
      ;;
  esac
else
  echo "Error: stats.html not found at $STATS_FILE"
  exit 1
fi
