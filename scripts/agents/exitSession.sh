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

# Schedule the exit command to run in the background after this script exits.
# This ensures Claude Code is back at its interactive prompt when /exit is sent.
# Using nohup prevents the background process from being killed when parent exits.
nohup sh -c 'sleep "$1" && tmux send-keys "/exit" Enter' sh "$DELAY" >/dev/null 2>&1 &
