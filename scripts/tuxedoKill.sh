#!/bin/sh
# tuxedoKill - fully terminate tuxedo.sh (neovim, screen, and tmux sessions)
#
# Usage:
#   tuxedoKill.sh           # Kill neovim, screen sessions, and tmux session
#   tuxedoKill.sh -h        # Show help

set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

SESSION_NAME="tuxedo"

# Check for pgrep/pkill availability (used to kill neovim sessions)
if command -v pgrep >/dev/null 2>&1 && command -v pkill >/dev/null 2>&1; then
    HAS_PGREP=true
else
    HAS_PGREP=false
fi

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
if [ "$HAS_PGREP" = true ]; then
    nvim_pattern="nvim.*$SCRIPT_DIR/config/neovim.lua"
    nvim_count=$(pgrep -f "$nvim_pattern" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$nvim_count" -gt 0 ]; then
        pkill -f "$nvim_pattern" 2>/dev/null || true
        echo "Killed $nvim_count neovim session(s)"
    else
        echo "No tuxedo neovim sessions found"
    fi
else
    echo "Note: pgrep/pkill not found. Neovim sessions not terminated."
    echo "Install with: brew install proctools (macOS) or apt install procps (Linux)"
fi

# Clean up dead screen sessions first
screen -wipe >/dev/null 2>&1 || true

# Determine screen socket directory (check SCREENDIR, common locations, then fallback)
if [ -n "${SCREENDIR:-}" ] && [ -d "$SCREENDIR" ]; then
    SCREEN_SOCKET_DIR="$SCREENDIR"
elif [ -d "/run/screen/S-$USER" ]; then
    SCREEN_SOCKET_DIR="/run/screen/S-$USER"
elif [ -d "/var/run/screen/S-$USER" ]; then
    SCREEN_SOCKET_DIR="/var/run/screen/S-$USER"
else
    SCREEN_SOCKET_DIR="$HOME/.screen"
fi

# Find and kill screen sessions
screen_sessions=$(screen -ls 2>/dev/null | awk '/tux-/ {print $1}')

if [ -n "$screen_sessions" ]; then
    killed=0
    removed=0
    for session in $screen_sessions; do
        # Try graceful quit first (works for live sessions)
        if screen -X -S "$session" quit >/dev/null 2>&1; then
            killed=$((killed + 1))
        else
            # For dead sessions, remove the socket file directly
            socket_file="$SCREEN_SOCKET_DIR/$session"
            if [ -e "$socket_file" ]; then
                rm -f "$socket_file" && removed=$((removed + 1))
            fi
        fi
    done
    [ "$killed" -gt 0 ] && echo "Killed $killed screen session(s)"
    [ "$removed" -gt 0 ] && echo "Removed $removed dead screen session(s)"
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
