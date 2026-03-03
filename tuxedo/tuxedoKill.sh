#!/bin/sh
# tuxedoKill - fully terminate tuxedo.sh (neovim, inner tmux, and outer tmux sessions)
#
# Usage:
#   tuxedoKill.sh           # Kill neovim, inner tmux sessions, and outer tmux session
#   tuxedoKill.sh -h        # Show help

set -eu
SCRIPT_PATH="${TUXEDO_SCRIPT_PATH:-$0}"
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

SESSION_NAME="tuxedo"
INNER_TMUX_SOCKET="tuxedo-inner"

# Check for pgrep/pkill availability (used to kill neovim sessions)
if command -v pgrep >/dev/null 2>&1 && command -v pkill >/dev/null 2>&1; then
    HAS_PGREP=true
else
    HAS_PGREP=false
fi

if command -v tmux >/dev/null 2>&1; then
    HAS_TMUX=true
else
    HAS_TMUX=false
fi

# Parse arguments
for arg in "$@"; do
    case "$arg" in
        -h|--help)
            echo "Usage: tuxedoKill.sh [OPTIONS]"
            echo ""
            echo "Fully terminate tuxedo.sh - kills neovim editors, inner tmux sessions,"
            echo "and the outer tmux session."
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

# When $TMUX is set, bare tmux commands route to the socket in $TMUX (which
# may be tuxedo-inner). We need bare "tmux" to reach the default socket where
# the outer "tuxedo" session lives. Use TMUX= to unset it for outer commands.
# tmux -L explicitly targets a named socket regardless of $TMUX.

# Detect if we're running inside the tuxedo session tree.
INSIDE_TUXEDO=false
if [ "$HAS_TMUX" = "true" ] && [ -n "${TMUX:-}" ]; then
    case "$TMUX" in
        *tuxedo-inner*) INSIDE_TUXEDO=true ;;
    esac
    if [ "$INSIDE_TUXEDO" = false ]; then
        current_session=$(tmux display-message -p '#{session_name}' 2>/dev/null || true)
        if [ "$current_session" = "$SESSION_NAME" ]; then
            INSIDE_TUXEDO=true
        fi
    fi
fi

if [ "$INSIDE_TUXEDO" = true ]; then
    echo "Killing tuxedo (from within)..."

    # Detach all kills into a background process so this script's shell
    # can exit before the sessions that host it are destroyed.
    nohup sh -c "
        sleep 0.2

        # Kill neovim processes
        if command -v pkill >/dev/null 2>&1; then
            pkill -f 'nvim.*$SCRIPT_DIR/config/neovim.lua' 2>/dev/null || true
        fi

        # Kill inner tmux server (all sessions on the tuxedo-inner socket)
        tmux -L '$INNER_TMUX_SOCKET' kill-server 2>/dev/null || true

        # Kill outer tmux session on the default socket.
        # TMUX= ensures we reach the default server, not tuxedo-inner.
        TMUX= tmux kill-session -t '$SESSION_NAME' 2>/dev/null || true
    " >/dev/null 2>&1 &
else
    # Not inside tuxedo — safe to kill everything directly.

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

    # Kill inner tmux server (all sessions on the socket at once)
    if [ "$HAS_TMUX" = "true" ]; then
        inner_sessions=$(tmux -L "$INNER_TMUX_SOCKET" list-sessions 2>/dev/null || true)
        if [ -n "$inner_sessions" ]; then
            tmux -L "$INNER_TMUX_SOCKET" kill-server 2>/dev/null || true
            echo "Killed inner tmux server ($INNER_TMUX_SOCKET)"
        else
            echo "No inner tmux sessions found"
        fi
    fi

    # Kill outer tmux session (TMUX= to ensure default socket)
    if [ "$HAS_TMUX" = "true" ]; then
        if TMUX= tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
            TMUX= tmux kill-session -t "$SESSION_NAME"
            echo "Killed tmux session: $SESSION_NAME"
        else
            echo "No tmux session '$SESSION_NAME' found"
        fi
    else
        echo "Note: tmux not found. Tmux session not cleaned up."
    fi
fi
