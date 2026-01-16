#!/bin/sh
# Tuxedo - tmux session manager for rapid development
#
# Configurable via environment variables:
#   TUXEDO_BASE_DIR     - Base directory for workspaces (default: $HOME/github)
#   TUXEDO_EDITOR       - Editor command (default: uses local nvim config)
#   TUXEDO_WORKSPACES   - Number of workspaces to create (default: 20)
#
# Shared resources:
#   rapid-shared/ is the source of truth for shared directories (not version controlled).
#   CLAUDE.md is NOT symlinked since it's tracked in git.
#
# Screen session persistence:
#   Each workspace runs inside a GNU screen session. If you kill tmux,
#   the screen sessions survive. When you restart tuxedo.sh, it reattaches
#   to existing screen sessions, preserving running processes (like Claude agents).
#
# To detach: tmux detach (or Ctrl+B, D)
# To destroy: tmux kill-session -t tuxedo
# To kill screens too: screen -ls | grep tux- | cut -d. -f1 | xargs -I{} screen -X -S {} quit

set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

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

# Ensure symlinks from a workspace to rapid-shared for shared directories
# (CLAUDE.md is version controlled, so not symlinked)
ensure_symlinks() {
    workspace="$1"

    # Skip if workspace doesn't exist
    [ -d "$workspace" ] || return 0

    # Skip rapid-shared itself
    [ "$workspace" = "$SHARED_DIR" ] && return 0

    # Symlink these directories (not version controlled in workspaces)
    for item in .secrets .test_files; do
        target="$SHARED_DIR/$item"
        link="$workspace/$item"
        relative_path="../rapid-shared/$item"

        # Skip if shared folder doesn't exist
        [ -d "$target" ] || continue

        # If it's already a correct symlink, skip
        if [ -L "$link" ]; then
            current_target=$(readlink "$link")
            if [ "$current_target" = "$target" ] || [ "$current_target" = "$relative_path" ]; then
                continue
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
    done
}

# Use local configs
TMUX_CONF="$CONFIG_DIR/tmux.conf"
NVIM_INIT="$CONFIG_DIR/neovim.lua"
EDITOR="${TUXEDO_EDITOR:-nvim -u $NVIM_INIT}"

# Check if screen is available for session persistence
if command -v screen >/dev/null 2>&1; then
    USE_SCREEN=true
else
    USE_SCREEN=false
    echo "Note: GNU screen not found. Sessions won't persist across tmux restarts."
    echo "Install with: brew install screen"
fi

# Get or create a screen session for a workspace
# Returns the command to run in a tmux pane
screen_cmd() {
    screen_name="$1"
    if [ "$USE_SCREEN" = true ]; then
        # -d -RR: detach from elsewhere if attached, reattach or create new
        # -c $CONFIG_DIR/screenrc: use our config for scrollback and mouse support
        # -T tmux-256color: enable true color support for proper terminal colors
        echo "screen -T tmux-256color -d -RR $screen_name -c \"$CONFIG_DIR/screenrc\""
    else
        # Fallback: just run the shell
        echo ""
    fi
}

# Update a workspace from main if it's on main branch with no uncommitted changes
update_from_main() {
    workspace="$1"

    # Skip if workspace doesn't exist or isn't a git repo
    [ -d "$workspace/.git" ] || return 0

    # Get current branch
    current_branch=$(git -C "$workspace" rev-parse --abbrev-ref HEAD 2>/dev/null)
    [ "$current_branch" = "main" ] || return 0

    # Check for uncommitted changes (staged or unstaged)
    if ! git -C "$workspace" diff --quiet 2>/dev/null || ! git -C "$workspace" diff --cached --quiet 2>/dev/null; then
        return 0  # Has uncommitted changes, skip
    fi

    # Check for untracked files (optional - skip if any exist)
    # if [ -n "$(git -C "$workspace" ls-files --others --exclude-standard 2>/dev/null)" ]; then
    #     return 0
    # fi

    # Fetch and fast-forward pull from main (no merge commits)
    echo "Updating $(basename "$workspace") from main..."
    git -C "$workspace" fetch origin main --quiet 2>/dev/null || true
    if ! git -C "$workspace" pull --ff-only origin main --quiet 2>/dev/null; then
        echo "Warning: Failed to fast-forward $(basename "$workspace"). May have diverged." >&2
    fi
}

# Update all workspaces that are on main with no uncommitted changes (parallel)
update_all_workspaces() {
    echo "Checking workspaces for updates..."
    update_from_main "$BASE_DIR/rapid-main" &
    i=2
    while [ "$i" -le "$NUM_WORKSPACES" ]; do
        update_from_main "$BASE_DIR/rapid${i}" &
        i=$((i + 1))
    done
    wait  # Wait for all background updates to complete
}

# Sync VS Code window title to tmux window name
# If .vscode/settings.json has a window.title, use it for tmux
# Truncates long titles to keep tmux tab bar readable
sync_vscode_title() {
    workspace="$1"
    window_name="$2"
    settings_file="$workspace/.vscode/settings.json"
    max_length=25

    # Skip if no settings file or jq not available
    [ -f "$settings_file" ] && command -v jq >/dev/null 2>&1 || return 0

    # Read the window.title from VS Code settings
    vscode_title=$(jq -r '.["window.title"] // empty' "$settings_file" 2>/dev/null)

    # If a title is set, truncate and rename the tmux window
    if [ -n "$vscode_title" ]; then
        # Truncate to max_length chars, add ellipsis if truncated
        if [ ${#vscode_title} -gt $max_length ]; then
            truncate_len=$((max_length - 3))
            vscode_title="$(printf '%.*s' "$truncate_len" "$vscode_title")..."
        fi
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

# Save base PATH before any modifications (used for per-workspace PATH)
BASE_PATH="$PATH"

# Build a workspace-specific PATH that includes that workspace's scripts
workspace_path() {
    workspace="$1"
    [ -z "$workspace" ] && { echo "$BASE_PATH"; return; }
    echo "$workspace/scripts:$workspace/scripts/agents:$BASE_PATH"
}

# Update workspaces that are on main with no uncommitted changes FIRST
# This ensures .gitignore changes are pulled before symlinks are created
update_all_workspaces

# Enforce symlinks for all workspaces after updating from main
if [ -d "$SHARED_DIR" ]; then
    # Ensure shared directories exist
    mkdir -p "$SHARED_DIR/.test_files" "$SHARED_DIR/.secrets"

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
# Terminal pane runs in a persistent screen session
screen_shared=$(screen_cmd tux-shared)
shared_path=$(workspace_path "$SHARED_DIR")
if [ -n "$screen_shared" ]; then
    tmux -f "$TMUX_CONF" new-session -d -s "$SESSION_NAME" -c "$SHARED_DIR" -n rapid-shared -e "PATH=$shared_path" "$screen_shared"
else
    tmux -f "$TMUX_CONF" new-session -d -s "$SESSION_NAME" -c "$SHARED_DIR" -n rapid-shared -e "PATH=$shared_path"
fi
tmux split-window -h -t "$SESSION_NAME:rapid-shared" -c "$SHARED_DIR" -e "PATH=$shared_path" "$EDITOR"

# Add rapid-main as second window
screen_main=$(screen_cmd tux-main)
main_path=$(workspace_path "$BASE_DIR/rapid-main")
if [ -n "$screen_main" ]; then
    tmux new-window -t "$SESSION_NAME" -c "$BASE_DIR/rapid-main" -n rapid-main -e "PATH=$main_path" "$screen_main"
else
    tmux new-window -t "$SESSION_NAME" -c "$BASE_DIR/rapid-main" -n rapid-main -e "PATH=$main_path"
fi
tmux split-window -h -t "$SESSION_NAME:rapid-main" -c "$BASE_DIR/rapid-main" -e "PATH=$main_path" "$EDITOR"

i=2
while [ "$i" -le "$NUM_WORKSPACES" ]; do
    workspace_dir="$BASE_DIR/rapid${i}"
    ws_path=$(workspace_path "$workspace_dir")
    screen_i=$(screen_cmd "tux-${i}")
    if [ -n "$screen_i" ]; then
        tmux new-window -t "$SESSION_NAME" -c "$workspace_dir" -n "rapid${i}" -e "PATH=$ws_path" "$screen_i"
    else
        tmux new-window -t "$SESSION_NAME" -c "$workspace_dir" -n "rapid${i}" -e "PATH=$ws_path"
    fi
    tmux split-window -h -t "$SESSION_NAME:rapid${i}" -c "$workspace_dir" -e "PATH=$ws_path" "$EDITOR"
    i=$((i + 1))
done

# Sync VS Code titles to tmux window names
sync_all_titles

tmux select-window -t "$SESSION_NAME:0"
tmux attach-session -t "$SESSION_NAME"
