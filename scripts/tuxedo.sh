#!/bin/sh
# Tuxedo - tmux session manager for rapid development
#
# Configurable via environment variables:
#   TUXEDO_BASE_DIR     - Base directory for workspaces (default: $HOME/github)
#   TUXEDO_EDITOR       - Editor command (default: uses local nvim config)
#   TUXEDO_WORKSPACES   - Number of workspaces to create (default: 20)
#
# Shared resources:
#   rapid-shared/ is the source of truth for .secrets (not version controlled).
#   .claude and CLAUDE.md are NOT symlinked since they're tracked in git.
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

# Ensure symlinks from a workspace to rapid-shared for .secrets only
# (.claude and CLAUDE.md are version controlled, so not symlinked)
ensure_symlinks() {
    workspace="$1"

    # Skip if workspace doesn't exist
    [ -d "$workspace" ] || return 0

    # Skip rapid-shared itself
    [ "$workspace" = "$SHARED_DIR" ] && return 0

    # Only symlink .secrets (not version controlled)
    target="$SHARED_DIR/.secrets"
    link="$workspace/.secrets"
    relative_path="../rapid-shared/.secrets"

    # Skip if shared folder doesn't exist
    [ -d "$target" ] || return 0

    # If it's already a correct symlink, skip
    if [ -L "$link" ]; then
        current_target=$(readlink "$link")
        if [ "$current_target" = "$target" ] || [ "$current_target" = "$relative_path" ]; then
            return 0
        fi
        # Wrong symlink, remove it
        rm "$link"
    elif [ -d "$link" ]; then
        # It's a real directory - remove it (symlink to shared will replace it)
        echo "Removing directory '$link' (will be symlinked to shared)"
        rm -rf "$link"
    elif [ -e "$link" ]; then
        # Some other file exists, remove it
        rm "$link"
    fi

    # Create the symlink (relative path for portability)
    ln -s "$relative_path" "$link"
    echo "Symlinked $link -> $relative_path"
}

# Use local configs
TMUX_CONF="$CONFIG_DIR/tmux.conf"
NVIM_INIT="$CONFIG_DIR/neovim.lua"
EDITOR="${TUXEDO_EDITOR:-nvim -u $NVIM_INIT}"

# Sync VS Code window title to tmux window name
# If .vscode/settings.json has a window.title, use it for tmux
sync_vscode_title() {
    workspace="$1"
    window_name="$2"
    settings_file="$workspace/.vscode/settings.json"

    # Skip if no settings file or jq not available
    [ -f "$settings_file" ] && command -v jq >/dev/null 2>&1 || return 0

    # Read the window.title from VS Code settings
    vscode_title=$(jq -r '.["window.title"] // empty' "$settings_file" 2>/dev/null)

    # If a title is set, rename the tmux window
    if [ -n "$vscode_title" ]; then
        tmux rename-window -t "$SESSION_NAME:$window_name" "$vscode_title" 2>/dev/null || true
    fi
}

# Sync all workspace titles from VS Code to tmux
sync_all_titles() {
    sync_vscode_title "$BASE_DIR/rapid-main" "rapid-main"
    i=2
    while [ "$i" -le "$NUM_WORKSPACES" ]; do
        sync_vscode_title "$BASE_DIR/rapid${i}" "rapid${i}"
        i=$((i + 1))
    done
}

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
    # Sync VS Code titles before attaching
    sync_all_titles
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

# Sync VS Code titles to tmux window names
sync_all_titles

tmux select-window -t "$SESSION_NAME:0"
tmux attach-session -t "$SESSION_NAME"
