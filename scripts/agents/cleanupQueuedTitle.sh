#!/bin/sh
# Cleanup script for SessionEnd hook
# Removes "(queued)" prefix from VS Code title if present

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SETTINGS_FILE="$REPO_ROOT/.vscode/settings.json"

# Exit silently if settings file doesn't exist
if [ ! -f "$SETTINGS_FILE" ]; then
    exit 0
fi

# Check if jq is available
if ! command -v jq >/dev/null 2>&1; then
    exit 0
fi

# Get current title
CURRENT_TITLE=$(jq -r '.["window.title"] // ""' "$SETTINGS_FILE" 2>/dev/null || true)

# Check if title contains "(queued)" and reset if so
case "$CURRENT_TITLE" in
    *"(queued)"*)
        "$SCRIPT_DIR/setVscodeTitle.sh"
        ;;
esac
