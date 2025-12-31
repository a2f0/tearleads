#!/bin/sh
# Mark workspace as queued: updates VS Code title and tmux window name,
# then moves tmux window to the front of the window list.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Get PR info for the title
TITLE="${1:-}"
if [ -z "$TITLE" ]; then
    echo "Usage: $0 \"(queued) #<pr-number> - <branch>\"" >&2
    exit 1
fi

# Update VS Code title
"$SCRIPT_DIR/setVscodeTitle.sh" "$TITLE"

# Update tmux window if we're in a tmux session
if [ -n "${TMUX:-}" ]; then
    # Get current window info
    CURRENT_WINDOW=$(tmux display-message -p '#I')
    ORIGINAL_NAME=$(tmux display-message -p '#W')

    # Store original name for later restoration (if not already queued)
    case "$ORIGINAL_NAME" in
        "(queued) "*)
            # Already queued, don't rename again
            ;;
        *)
            # Store original name as a window option (follows window when moved)
            tmux set-option -w @original_name "$ORIGINAL_NAME"
            # Rename window with queued prefix
            tmux rename-window "(queued) ${ORIGINAL_NAME}"
            ;;
    esac

    # Move window to the front of the list by swapping with the first window
    FIRST_WINDOW=$(tmux list-windows -F '#I' | sort -n | head -1)
    if [ "$CURRENT_WINDOW" != "$FIRST_WINDOW" ]; then
        tmux swap-window -t "$FIRST_WINDOW"
    fi

    echo "Tmux window marked as queued and moved to front"
fi
