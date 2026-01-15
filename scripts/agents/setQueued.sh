#!/bin/sh
# Mark workspace as queued: updates VS Code title and tmux window name.
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)


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

    # Get base name (strip any status prefix)
    case "$ORIGINAL_NAME" in
        "(working) "*|"(waiting) "*|"(queued) "*)
            BASE_NAME="${ORIGINAL_NAME#* }"
            ;;
        *)
            BASE_NAME="$ORIGINAL_NAME"
            ;;
    esac

    # Store original name if not already stored
    STORED_NAME=$(tmux show-option -wqv @original_name 2>/dev/null || true)
    if [ -z "$STORED_NAME" ]; then
        tmux set-option -w @original_name "$BASE_NAME"
    fi

    # Set queued status flag and clear other status flags
    tmux set-option -w @queued_status "true"
    tmux set-option -wu @working_status 2>/dev/null || true
    tmux set-option -wu @waiting_status 2>/dev/null || true

    # Rename window with queued prefix
    tmux rename-window "(queued) $BASE_NAME"

    echo "Tmux window marked as queued"
fi
