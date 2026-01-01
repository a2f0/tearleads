#!/bin/sh
# Tuxedo - tmux session manager for rapid development
#
# Configurable via environment variables:
#   TUXEDO_BASE_DIR     - Base directory for workspaces (default: $HOME/github)
#   TUXEDO_EDITOR       - Editor command (default: uses local nvim config)
#   TUXEDO_WORKSPACES   - Number of workspaces to create (default: 20)
#
# To detach: tmux detach (or Ctrl+B, D)
# To destroy: tmux kill-session -t tuxedo

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/config"
GHOSTTY_CONF="$CONFIG_DIR/ghostty.conf"

# If not in a terminal, launch Ghostty with this script
if [ ! -t 1 ] && command -v ghostty >/dev/null 2>&1; then
    exec ghostty --config-file="$GHOSTTY_CONF" -e "$0" "$@"
fi

BASE_DIR="${TUXEDO_BASE_DIR:-$HOME/github}"
NUM_WORKSPACES="${TUXEDO_WORKSPACES:-20}"
SESSION_NAME="tuxedo"

# Use local configs
TMUX_CONF="$CONFIG_DIR/tmux.conf"
NVIM_INIT="$CONFIG_DIR/neovim.lua"
EDITOR="${TUXEDO_EDITOR:-nvim -u $NVIM_INIT}"

# Export for tmux config reload binding
export TUXEDO_TMUX_CONF="$TMUX_CONF"

# Scripts directories to add to PATH
SCRIPTS_PATH="$SCRIPT_DIR:$SCRIPT_DIR/agents"

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux attach-session -t "$SESSION_NAME"
    exit 0
fi

tmux -f "$TMUX_CONF" new-session -d -s "$SESSION_NAME" -c "$BASE_DIR/rapid-main" -n rapid-main

# Add scripts directories to PATH for all windows in this session
tmux set-environment -t "$SESSION_NAME" PATH "$SCRIPTS_PATH:$PATH"

tmux split-window -h -t "$SESSION_NAME:rapid-main" -c "$BASE_DIR/rapid-main" "$EDITOR"

i=2
while [ "$i" -le "$NUM_WORKSPACES" ]; do
    tmux new-window -t "$SESSION_NAME" -c "$BASE_DIR/rapid${i}" -n "rapid${i}"
    tmux split-window -h -t "$SESSION_NAME:rapid${i}" -c "$BASE_DIR/rapid${i}" "$EDITOR"
    i=$((i + 1))
done

# Enable mouse support for this session only (not globally)
tmux set-option -t "$SESSION_NAME" mouse on

tmux select-window -t "$SESSION_NAME:0"
tmux attach-session -t "$SESSION_NAME"
