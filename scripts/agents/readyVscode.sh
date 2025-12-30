#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Set VS Code window title to "ready"
"$REPO_ROOT/scripts/setVscodeTitle.sh" "ready"

# Switch to main and pull latest
cd "$REPO_ROOT"
git switch main
git pull

echo "Ready for next task."
