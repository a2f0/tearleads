#!/bin/sh
# shellcheck disable=SC1091
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

# Source library if available
if [ -f "$SCRIPT_DIR/lib/tuxedo-kill-lib.sh" ]; then
    . "$SCRIPT_DIR/lib/tuxedo-kill-lib.sh"
    USE_LIB=true
else
    USE_LIB=false
fi

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
# Uses SIGKILL (-9) to ensure processes cannot ignore the signal
if [ "$USE_LIB" = true ]; then
    nvim_count=$(count_nvim_sessions "$SCRIPT_DIR")
    if [ "$nvim_count" -gt 0 ]; then
        kill_nvim_sessions "$SCRIPT_DIR" || true
        echo "Killed $nvim_count neovim session(s)"
    else
        echo "No tuxedo neovim sessions found"
    fi
elif [ "$HAS_PGREP" = true ]; then
    nvim_pattern="nvim.*$SCRIPT_DIR/config/neovim.lua"
    nvim_count=$(pgrep -f "$nvim_pattern" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$nvim_count" -gt 0 ]; then
        pkill -9 -f "$nvim_pattern" 2>/dev/null || true
        echo "Killed $nvim_count neovim session(s)"
    else
        echo "No tuxedo neovim sessions found"
    fi
else
    echo "Note: pgrep/pkill not found. Neovim sessions not terminated."
    echo "Install with: brew install proctools (macOS) or apt install procps (Linux)"
fi

# Kill screen sessions by finding processes directly
# Uses SIGKILL (-9) to ensure processes cannot ignore the signal
if [ "$USE_LIB" = true ]; then
    screen_count=$(count_screen_sessions)
    if [ "$screen_count" -gt 0 ]; then
        kill_screen_sessions || true
        echo "Killed $screen_count screen session(s)"
    else
        echo "No tux-* screen processes found"
    fi
elif [ "$HAS_PGREP" = true ]; then
    screen_pids=$(pgrep -f 'screen.*tux-' 2>/dev/null || true)
    if [ -n "$screen_pids" ]; then
        screen_count=$(echo "$screen_pids" | wc -l | tr -d ' ')
        pkill -9 -f 'screen.*tux-' 2>/dev/null || true
        echo "Killed $screen_count screen session(s)"
    else
        echo "No tux-* screen processes found"
    fi
fi

# Clean up screen socket files
if [ "$USE_LIB" = true ]; then
    socket_count=$(count_screen_sockets)
    if cleanup_screen_sockets; then
        echo "Removed $socket_count screen socket(s) from ~/.screen"
    fi
else
    # Clean up screen socket files in ~/.screen (used by brew's screen)
    # These persist even after processes are killed and cause session "resurrection"
    if [ -d "$HOME/.screen" ]; then
        socket_count=0
        for socket in "$HOME/.screen/"*tux-*; do
            [ -e "$socket" ] || continue
            rm -f "$socket" && socket_count=$((socket_count + 1))
        done
        [ "$socket_count" -gt 0 ] && echo "Removed $socket_count screen socket(s) from ~/.screen"
    fi

    # Also clean sockets in macOS temp location (used by system screen)
    screen -wipe >/dev/null 2>&1 || true
fi

# Kill tmux session
if [ "$USE_LIB" = true ]; then
    if kill_tmux_session "$SESSION_NAME"; then
        echo "Killed tmux session: $SESSION_NAME"
    else
        echo "No tmux session '$SESSION_NAME' found"
    fi
else
    if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        tmux kill-session -t "$SESSION_NAME"
        echo "Killed tmux session: $SESSION_NAME"
    else
        echo "No tmux session '$SESSION_NAME' found"
    fi
fi
