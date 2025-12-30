#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Switch to main and pull latest
cd "$REPO_ROOT"
git switch main
git pull

# Update VS Code window title (will set to "ready" since on main)
"$SCRIPT_DIR/setVscodeTitle.sh"

echo "Ready for next task."
