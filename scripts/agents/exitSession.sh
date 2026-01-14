#!/bin/sh
# Exit a Codex or Claude Code session via tmux.
# Usage: exitSession.sh [delay_seconds]
# Optional: set EXIT_COMMAND to "/quit" (Codex) or "/exit" (Claude) to override auto-detection.
# Default delay is 2 seconds to allow final output to be displayed.
set -eu

DELAY="${1:-2}"

# Only works in tmux
if [ -z "${TMUX:-}" ]; then
    echo "Not in tmux, cannot auto-exit" >&2
    exit 0
fi

# Schedule the exit command to run in the background after this script exits.
# This ensures the agent is back at its interactive prompt when the exit command is sent.
# Using nohup prevents the background process from being killed when parent exits.
exit_command="${EXIT_COMMAND:-}"
# Allow explicit override for Codex (/quit) vs Claude (/exit).
if [ -n "$exit_command" ]; then
    case "$exit_command" in
        "/quit" | "/exit")
            ;;
        *)
            echo "Invalid EXIT_COMMAND: use /quit or /exit" >&2
            exit 1
            ;;
    esac
else
    exit_command="/exit"
    # Codex sets CODEX_HOME via scripts/codex.sh, so prefer /quit there.
    if [ -n "${CODEX_HOME:-}" ]; then
        exit_command="/quit"
    fi
fi

nohup sh -c 'sleep "$1" && tmux send-keys "$2" Enter' sh "$DELAY" "$exit_command" >/dev/null 2>&1 &
