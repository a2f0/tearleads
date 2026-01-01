#!/bin/sh
# Clear queued status: resets VS Code title and tmux window name,
# then moves tmux window to the back of the window list.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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
        tmux set-option -wu @queued_status 2>/dev/null || true
    else
        # If no stored name, remove "(queued) " prefix if present
        case "$CURRENT_NAME" in
            "(queued) "*)
                NEW_NAME="${CURRENT_NAME#\(queued\) }"
                tmux rename-window "$NEW_NAME"
                ;;
        esac
        # Clean up queued status flag
        tmux set-option -wu @queued_status 2>/dev/null || true
    fi

    # Move window to the back of the list by swapping with the last window
    # Re-fetch current position (may have changed after rename)
    CURRENT_WINDOW=$(tmux display-message -p '#I')
    LAST_WINDOW=$(tmux list-windows -F '#I' | sort -n | tail -1)
    if [ "$CURRENT_WINDOW" != "$LAST_WINDOW" ]; then
        tmux swap-window -t "$LAST_WINDOW"
    fi

    echo "Tmux window cleared from queue and moved to back"
fi
