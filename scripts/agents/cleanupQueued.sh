#!/bin/sh
# Cleanup script for SessionEnd hook
# Removes "(queued)" prefix from VS Code title and tmux window if present,
# and moves tmux window to the back of the list.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SETTINGS_FILE="$REPO_ROOT/.vscode/settings.json"
IS_QUEUED=false

# Check if VS Code title contains "(queued)"
if [ -f "$SETTINGS_FILE" ] && command -v jq >/dev/null 2>&1; then
    CURRENT_TITLE=$(jq -r '.["window.title"] // ""' "$SETTINGS_FILE" 2>/dev/null || true)
    case "$CURRENT_TITLE" in
        *"(queued)"*)
            IS_QUEUED=true
            ;;
    esac
fi

# Check if tmux window has queued status (via window option or name prefix)
if [ -n "${TMUX:-}" ]; then
    # Check for @original_name window option (set when queued)
    ORIGINAL_NAME=$(tmux show-option -wqv @original_name 2>/dev/null || true)
    if [ -n "$ORIGINAL_NAME" ]; then
        IS_QUEUED=true
    else
        # Fallback: check window name for "(queued)" prefix
        CURRENT_NAME=$(tmux display-message -p '#W' 2>/dev/null || true)
        case "$CURRENT_NAME" in
            "(queued) "*)
                IS_QUEUED=true
                ;;
        esac
    fi
fi

# If queued, clear the status
if [ "$IS_QUEUED" = true ]; then
    "$SCRIPT_DIR/clearQueued.sh"
fi
