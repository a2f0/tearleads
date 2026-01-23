#!/bin/sh
# Cleanup script for SessionEnd hook
# Removes all status prefixes (working/waiting/queued) from VS Code title and tmux window.
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

REPO_ROOT="$(git rev-parse --show-toplevel)"
SETTINGS_FILE="$REPO_ROOT/.vscode/settings.json"

HAS_STATUS=false

# Check if VS Code title has any status prefix
if [ -f "$SETTINGS_FILE" ] && command -v jq >/dev/null 2>&1; then
    CURRENT_TITLE=$(jq -r '.["window.title"] // ""' "$SETTINGS_FILE" 2>/dev/null || true)
    case "$CURRENT_TITLE" in
        "(working)"*|"(waiting)"*|"(queued)"*)
            HAS_STATUS=true
            ;;
    esac
fi

# Check tmux window for any status
if [ -n "${TMUX:-}" ]; then
    WORKING=$(tmux show-option -wqv @working_status 2>/dev/null || true)
    WAITING=$(tmux show-option -wqv @waiting_status 2>/dev/null || true)
    QUEUED=$(tmux show-option -wqv @queued_status 2>/dev/null || true)
    ORIGINAL=$(tmux show-option -wqv @original_name 2>/dev/null || true)

    if [ "$WORKING" = "true" ] || [ "$WAITING" = "true" ] || [ "$QUEUED" = "true" ] || [ -n "$ORIGINAL" ]; then
        HAS_STATUS=true
    fi

    # Also check window name prefix as fallback
    if [ "$HAS_STATUS" = false ]; then
        CURRENT_NAME=$(tmux display-message -p '#W' 2>/dev/null || true)
        case "$CURRENT_NAME" in
            "(working) "*|"(waiting) "*|"(queued) "*)
                HAS_STATUS=true
                ;;
        esac
    fi
fi

if [ "$HAS_STATUS" = false ]; then
    # No status to clean up
    exit 0
fi

# Reset VS Code title (auto-detects based on branch)
"$SCRIPT_DIR/setVscodeTitle.sh"

# Update tmux window if we're in a tmux session
if [ -n "${TMUX:-}" ]; then
    CURRENT_WINDOW=$(tmux display-message -p '#I')
    CURRENT_NAME=$(tmux display-message -p '#W')

    # Try to restore original name from window option
    ORIGINAL_NAME=$(tmux show-option -wqv @original_name 2>/dev/null || true)

    if [ -n "$ORIGINAL_NAME" ]; then
        # Restore original name
        tmux rename-window "$ORIGINAL_NAME"
    else
        # If no stored name, remove status prefix if present
        case "$CURRENT_NAME" in
            "(working) "*|"(waiting) "*|"(queued) "*)
                NEW_NAME="${CURRENT_NAME#* }"
                tmux rename-window "$NEW_NAME"
                ;;
        esac
    fi

    # Clear all status flags and stored name
    tmux set-option -wu @original_name 2>/dev/null || true
    tmux set-option -wu @working_status 2>/dev/null || true
    tmux set-option -wu @waiting_status 2>/dev/null || true
    tmux set-option -wu @queued_status 2>/dev/null || true

    echo "Tmux window cleaned up"
fi
