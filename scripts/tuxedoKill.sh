#!/bin/sh
# tuxedoKill - terminate screen sessions and optionally tmux session for tuxedo
#
# Usage:
#   tuxedoKill.sh           # Kill all tux-* screen sessions
#   tuxedoKill.sh --all     # Kill screen sessions AND tmux session
#   tuxedoKill.sh -a        # Same as --all

set -eu

SESSION_NAME="tuxedo"
KILL_TMUX=false

# Parse arguments
for arg in "$@"; do
    case "$arg" in
        -a|--all)
            KILL_TMUX=true
            ;;
        -h|--help)
            echo "Usage: tuxedoKill.sh [OPTIONS]"
            echo ""
            echo "Terminate screen sessions created by tuxedo.sh"
            echo ""
            echo "Options:"
            echo "  -a, --all    Also kill the tmux session"
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

# Find and kill screen sessions
screen_sessions=$(screen -ls 2>/dev/null | grep 'tux-' | cut -d. -f1 | tr -d '\t' || true)

if [ -n "$screen_sessions" ]; then
    count=0
    for session in $screen_sessions; do
        screen -X -S "$session" quit 2>/dev/null && count=$((count + 1))
    done
    echo "Killed $count screen session(s)"
else
    echo "No tux-* screen sessions found"
fi

# Optionally kill tmux session
if [ "$KILL_TMUX" = true ]; then
    if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        tmux kill-session -t "$SESSION_NAME"
        echo "Killed tmux session: $SESSION_NAME"
    else
        echo "No tmux session '$SESSION_NAME' found"
    fi
fi
