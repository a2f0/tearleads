#!/bin/sh
# Clear working/waiting status: resets VS Code title and tmux window name,
# then moves tmux window to the back of the window list.
# Does NOT clear queued status - that is handled by clearQueued.sh
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

. "$SCRIPT_DIR/repoRoot.sh"
SETTINGS_FILE="$REPO_ROOT/.vscode/settings.json"

# Check if in queued state (don't clear if queued)
is_queued() {
    # Check VS Code title
    if [ -f "$SETTINGS_FILE" ] && command -v jq >/dev/null 2>&1; then
        CURRENT_TITLE=$(jq -r '.["window.title"] // ""' "$SETTINGS_FILE" 2>/dev/null || true)
        case "$CURRENT_TITLE" in
            "(queued)"*) return 0 ;;
        esac
    fi
    # Check tmux window option
    if [ -n "${TMUX:-}" ]; then
        QUEUED_STATUS=$(tmux show-option -wqv @queued_status 2>/dev/null || true)
        if [ "$QUEUED_STATUS" = "true" ]; then
            return 0
        fi
    fi
    return 1
}

# Check if in working or waiting state
has_status() {
    # Check VS Code title
    if [ -f "$SETTINGS_FILE" ] && command -v jq >/dev/null 2>&1; then
        CURRENT_TITLE=$(jq -r '.["window.title"] // ""' "$SETTINGS_FILE" 2>/dev/null || true)
        case "$CURRENT_TITLE" in
            "(working)"*|"(waiting)"*) return 0 ;;
        esac
    fi
    # Check tmux window options
    if [ -n "${TMUX:-}" ]; then
        WORKING=$(tmux show-option -wqv @working_status 2>/dev/null || true)
        WAITING=$(tmux show-option -wqv @waiting_status 2>/dev/null || true)
        if [ "$WORKING" = "true" ] || [ "$WAITING" = "true" ]; then
            return 0
        fi
    fi
    return 1
}

if is_queued; then
    echo "In queued state, not clearing status"
    exit 0
fi

if ! has_status; then
    echo "No working/waiting status to clear"
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
        # Clean up window options
        tmux set-option -wu @original_name 2>/dev/null || true
    else
        # If no stored name, remove status prefix if present
        case "$CURRENT_NAME" in
            "(working) "*|"(waiting) "*)
                NEW_NAME="${CURRENT_NAME#* }"
                tmux rename-window "$NEW_NAME"
                ;;
        esac
    fi

    # Clear status flags
    tmux set-option -wu @working_status 2>/dev/null || true
    tmux set-option -wu @waiting_status 2>/dev/null || true

    # Move window to the back of the list
    CURRENT_WINDOW=$(tmux display-message -p '#I')
    LAST_WINDOW=$(tmux list-windows -F '#I' | sort -n | tail -1)
    if [ "$CURRENT_WINDOW" != "$LAST_WINDOW" ]; then
        tmux swap-window -t "$LAST_WINDOW"
    fi

    echo "Tmux window status cleared and moved to back"
fi
