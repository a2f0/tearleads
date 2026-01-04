#!/bin/sh
# tuxedoKill - fully terminate tuxedo.sh (neovim, screen, and tmux sessions)
#
# Usage:
#   tuxedoKill.sh           # Kill neovim, screen sessions, and tmux session
#   tuxedoKill.sh -h        # Show help

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSION_NAME="tuxedo"

# Parse arguments
for arg in "$@"; do
    case "$arg" in
        -h|--help)
            echo "Usage: tuxedoKill.sh [OPTIONS]"
            echo ""
            echo "Fully terminate tuxedo.sh - kills neovim editors, screen sessions,"
            echo "and the tmux session."
            echo ""
            echo "Options:"
            echo "  -h, --help   Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Kill neovim processes started by tuxedo (identified by config path)
nvim_pattern="nvim.*$SCRIPT_DIR/config/neovim.lua"
nvim_count=$(pgrep -f "$nvim_pattern" 2>/dev/null | wc -l | tr -d ' ')
if [ "$nvim_count" -gt 0 ]; then
    pkill -f "$nvim_pattern" 2>/dev/null || true
    echo "Killed $nvim_count neovim session(s)"
else
    echo "No tuxedo neovim sessions found"
fi

# Find and kill screen sessions
screen_sessions=$(screen -ls 2>/dev/null | awk '/tux-/ {print $1}')

if [ -n "$screen_sessions" ]; then
    count=0
    for session in $screen_sessions; do
        screen -X -S "$session" quit 2>/dev/null && count=$((count + 1))
    done
    echo "Killed $count screen session(s)"
else
    echo "No tux-* screen sessions found"
fi

# Kill tmux session
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux kill-session -t "$SESSION_NAME"
    echo "Killed tmux session: $SESSION_NAME"
else
    echo "No tmux session '$SESSION_NAME' found"
fi
