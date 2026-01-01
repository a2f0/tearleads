#!/bin/sh
# Tuxedo - tmux session manager for rapid development
#
# Configurable via environment variables:
#   TUXEDO_BASE_DIR     - Base directory for workspaces (default: $HOME/github)
#   TUXEDO_EDITOR       - Editor command (default: uses local nvim config)
#   TUXEDO_WORKSPACES   - Number of workspaces to create (default: 20)
#
# Shared resources:
#   rapid-shared/ is the source of truth for .secrets and .claude folders.
#   These are symlinked into each workspace (rapid-main, rapid2, etc.)
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
SHARED_DIR="$BASE_DIR/rapid-shared"

# Ensure symlinks from a workspace to rapid-shared for .secrets and .claude
ensure_symlinks() {
    workspace="$1"

    # Skip if workspace doesn't exist
    [ -d "$workspace" ] || return 0

    # Skip rapid-shared itself
    [ "$workspace" = "$SHARED_DIR" ] && return 0

    for folder in .secrets .claude; do
        target="$SHARED_DIR/$folder"
        link="$workspace/$folder"

        # Skip if shared folder doesn't exist
        [ -d "$target" ] || continue

        # If it's already a correct symlink, skip
        if [ -L "$link" ]; then
            current_target=$(readlink "$link")
            if [ "$current_target" = "$target" ] || [ "$current_target" = "../rapid-shared/$folder" ]; then
                continue
            fi
            # Wrong symlink, remove it
            rm "$link"
        elif [ -d "$link" ]; then
            # It's a real directory - back it up and remove
            if [ -e "${link}.bak" ]; then
                echo "Error: Cannot back up '$link' because '${link}.bak' already exists. Please remove it and rerun." >&2
                exit 1
            fi
            echo "Warning: '$link' is a directory, backing up to '${link}.bak'"
            mv "$link" "${link}.bak"
        elif [ -e "$link" ]; then
            # Some other file exists, remove it
            rm "$link"
        fi

        # Create the symlink (relative path for portability)
        ln -s "../rapid-shared/$folder" "$link"
        echo "Symlinked $link -> ../rapid-shared/$folder"
    done
}

# Use local configs
TMUX_CONF="$CONFIG_DIR/tmux.conf"
NVIM_INIT="$CONFIG_DIR/neovim.lua"
EDITOR="${TUXEDO_EDITOR:-nvim -u $NVIM_INIT}"

# Export for tmux config reload binding
export TUXEDO_TMUX_CONF="$TMUX_CONF"

# Scripts directories to add to PATH
SCRIPTS_PATH="$SCRIPT_DIR:$SCRIPT_DIR/agents"

# Enforce symlinks for all workspaces before starting
if [ -d "$SHARED_DIR" ]; then
    ensure_symlinks "$BASE_DIR/rapid-main"
    i=2
    while [ "$i" -le "$NUM_WORKSPACES" ]; do
        ensure_symlinks "$BASE_DIR/rapid${i}"
        i=$((i + 1))
    done
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux attach-session -t "$SESSION_NAME"
    exit 0
fi

# Create session starting with rapid-shared (source of truth)
tmux -f "$TMUX_CONF" new-session -d -s "$SESSION_NAME" -c "$SHARED_DIR" -n rapid-shared
tmux split-window -h -t "$SESSION_NAME:rapid-shared" -c "$SHARED_DIR" "$EDITOR"

# Add rapid-main as second window
tmux new-window -t "$SESSION_NAME" -c "$BASE_DIR/rapid-main" -n rapid-main
tmux split-window -h -t "$SESSION_NAME:rapid-main" -c "$BASE_DIR/rapid-main" "$EDITOR"

# Add scripts directories to PATH for all windows in this session
tmux set-environment -t "$SESSION_NAME" PATH "$SCRIPTS_PATH:$PATH"

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
