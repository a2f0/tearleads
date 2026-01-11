#!/bin/sh
# Exit the Claude Code session via tmux.
# Usage: exitSession.sh [delay_seconds]
# Default delay is 2 seconds to allow final output to be displayed.
set -eu

DELAY="${1:-2}"

# Only works in tmux
if [ -z "${TMUX:-}" ]; then
    echo "Not in tmux, cannot auto-exit" >&2
    exit 0
fi

# Wait briefly for final output to render
sleep "$DELAY"

# Send /exit followed by Enter to the current pane
tmux send-keys "/exit" Enter
