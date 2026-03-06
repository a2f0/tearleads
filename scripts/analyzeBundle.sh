#!/bin/sh
set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
PM_SCRIPT="$SCRIPT_DIR/tooling/pm.sh"

# Bundle analyzer script - generates visual reports of JavaScript bundle composition
# Output: packages/client/dist/stats.html (opens automatically)

cd "$SCRIPT_DIR/.."

echo "Building with bundle analyzer..."
ANALYZE_BUNDLE=true sh "$PM_SCRIPT" --filter @tearleads/client run build

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
