#!/bin/sh

# Shared helpers for tuxedo.sh

tuxedo_init() {
    SCRIPT_DIR="$1"
    CONFIG_DIR="$SCRIPT_DIR/config"
    GHOSTTY_CONF="$CONFIG_DIR/ghostty.conf"

    BASE_DIR="${TUXEDO_BASE_DIR:-$HOME/github}"
    NUM_WORKSPACES="${TUXEDO_WORKSPACES:-10}"
    # Workspace naming: prefix-main, prefix-shared, prefix1, prefix2, etc.
    # Defaults to "tearleads" for backward compatibility (tearleads-main, tearleads2, ...)
    WORKSPACE_PREFIX="${TUXEDO_WORKSPACE_PREFIX:-tearleads}"
    # Starting index for numbered workspaces (default 2 for tearleads2, use 1 for tuxedo1)
    WORKSPACE_START="${TUXEDO_WORKSPACE_START:-2}"
    SESSION_NAME="tuxedo"
    OPEN_PRS_WINDOW_NAME="${TUXEDO_OPEN_PRS_WINDOW_NAME:-open-prs}"
    CLOSED_PRS_WINDOW_NAME="${TUXEDO_CLOSED_PRS_WINDOW_NAME:-closed-prs}"
    SHARED_DIR="$BASE_DIR/${WORKSPACE_PREFIX}-shared"
    MAIN_DIR="$BASE_DIR/${WORKSPACE_PREFIX}-main"
    # Directory for PR dashboards (separate from workspaces)
    DASHBOARD_DIR="${TUXEDO_DASHBOARD_DIR:-$BASE_DIR/${WORKSPACE_PREFIX}}"

    TMUX_CONF="$CONFIG_DIR/tmux.conf"
    NVIM_INIT="$CONFIG_DIR/neovim.lua"
    EDITOR="${TUXEDO_EDITOR:-nvim -u $NVIM_INIT -c 'Neotree show filesystem'}"

    export TUXEDO_TMUX_CONF="$TMUX_CONF"
    BASE_PATH="$PATH"
}

tuxedo_maybe_launch_ghostty() {
    exec_path="$1"
    shift

    if [ ! -t 1 ] && command -v ghostty >/dev/null 2>&1; then
        exec ghostty --config-file="$GHOSTTY_CONF" -e "$exec_path" "$@"
    fi
}

# Ensure symlinks from a workspace to the shared directory
# (CLAUDE.md is version controlled, so not symlinked)
ensure_symlinks() {
    workspace="$1"

    # Skip if workspace doesn't exist
    [ -d "$workspace" ] || return 0

    # Skip shared dir itself
    [ "$workspace" = "$SHARED_DIR" ] && return 0

    # Symlink these directories (not version controlled in workspaces)
    shared_basename=$(basename "$SHARED_DIR")
    for item in .secrets .test_files; do
        target="$SHARED_DIR/$item"
        link="$workspace/$item"
        relative_path="../${shared_basename}/$item"

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

    # Symlink package-specific files (mirrored path structure)
    for item in packages/api/.env; do
        target="$SHARED_DIR/$item"
        link="$workspace/$item"
        # Dynamically calculate relative path depth based on item path
        depth=$(echo "$item" | tr -cd '/' | wc -c | tr -d ' ')
        # Add 1 for the workspace directory itself
        depth=$((depth + 1))
        relative_prefix=$(printf '../%.0s' $(seq 1 $depth))
        relative_path="${relative_prefix}${shared_basename}/$item"

        # Skip if shared file doesn't exist
        [ -f "$target" ] || continue

        # Ensure parent directory exists
        link_dir=$(dirname "$link")
        [ -d "$link_dir" ] || continue

        # If it's already a correct symlink, skip
        if [ -L "$link" ]; then
            current_target=$(readlink "$link")
            if [ "$current_target" = "$target" ] || [ "$current_target" = "$relative_path" ]; then
                continue
            fi
            # Wrong symlink, remove it
            rm "$link"
        elif [ -f "$link" ]; then
            # It's a real file - remove it (symlink to shared will replace it)
            echo "Removing file '$link' (will be symlinked to shared)"
            rm "$link"
        elif [ -e "$link" ]; then
            # Some other type exists, remove it
            rm "$link"
        fi

        # Create the symlink (relative path for portability)
        ln -s "$relative_path" "$link"
        echo "Symlinked $link -> $relative_path"
    done
}

tuxedo_set_screen_flag() {
    if [ "${TUXEDO_FORCE_SCREEN:-}" = "1" ]; then
        USE_SCREEN=true
        return 0
    fi

    if [ "${TUXEDO_FORCE_NO_SCREEN:-}" = "1" ]; then
        USE_SCREEN=false
        return 0
    fi

    # Check if screen is available for session persistence
    if command -v screen >/dev/null 2>&1; then
        USE_SCREEN=true
    else
        USE_SCREEN=false
        echo "Note: GNU screen not found. Sessions won't persist across tmux restarts."
        echo "Install with: brew install screen"
    fi
}

# Get or create a screen session for a workspace
# Returns the command to run in a tmux pane
# Note: TUXEDO_WORKSPACE is passed via tmux -e flag, not via command prefix
screen_cmd() {
    screen_name="$1"
    if [ "$USE_SCREEN" = true ]; then
        # -d -RR: detach from elsewhere if attached, reattach or create new
        # -c $CONFIG_DIR/screenrc: use our config for scrollback and mouse support
        # -T tmux-256color: enable true color support for proper terminal colors
        echo "screen -T tmux-256color -d -RR $screen_name -c \"$CONFIG_DIR/screenrc\""
    else
        # Fallback: tmux will start default shell (TUXEDO_WORKSPACE comes from tmux -e)
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
    update_from_main "$MAIN_DIR" &
    i=$WORKSPACE_START
    while [ "$i" -le "$NUM_WORKSPACES" ]; do
        update_from_main "$BASE_DIR/${WORKSPACE_PREFIX}${i}" &
        i=$((i + 1))
    done
    wait  # Wait for all background updates to complete
}

tuxedo_truncate_title() {
    title="$1"
    max_length="$2"

    if [ ${#title} -le "$max_length" ]; then
        echo "$title"
        return 0
    fi

    truncate_len=$((max_length - 3))
    printf '%.*s...' "$truncate_len" "$title"
}

# Set window options for workspace:branch display in status bar
# - @workspace: stores the workspace directory, used by window-status-format
set_window_title_options() {
    local ws_dir="$1"
    local win_name="$2"
    [ -z "$ws_dir" ] || [ -z "$win_name" ] && return 0
    tmux set-option -w -t "$SESSION_NAME:$win_name" @workspace "$ws_dir" 2>/dev/null || true
}

# Legacy alias for backward compatibility
sync_vscode_title() {
    set_window_title_options "$@"
}

# Set window options for all workspace windows (for existing sessions)
# Iterates through all windows in the session and sets @workspace based on
# the pane's current working directory.
sync_all_titles() {
    # Get all windows in the session
    windows=$(tmux list-windows -t "$SESSION_NAME" -F '#{window_name}' 2>/dev/null) || return 0

    for win in $windows; do
        # Get workspace directory from pane's current path
        # Note: tmux show-environment doesn't work per-window, only per-session
        ws_dir=$(tmux display-message -t "$SESSION_NAME:$win" -p '#{pane_current_path}' 2>/dev/null)

        # Only set if we have a valid directory
        if [ -n "$ws_dir" ] && [ -d "$ws_dir" ]; then
            set_window_title_options "$ws_dir" "$win"
        fi
    done
}

# Build a workspace-specific PATH that includes that workspace's scripts
workspace_path() {
    workspace="$1"
    [ -z "$workspace" ] && { echo "$BASE_PATH"; return; }
    echo "$workspace/scripts:$workspace/scripts/agents:$BASE_PATH"
}

tuxedo_start_pr_dashboards() {
    [ "${TUXEDO_ENABLE_PR_DASHBOARDS:-1}" = "1" ] || return 0

    refresh_seconds="${TUXEDO_PR_REFRESH_SECONDS:-30}"
    pr_limit="${TUXEDO_PR_LIST_LIMIT:-20}"
    case $refresh_seconds in ''|*[!0-9]*) refresh_seconds=30 ;; esac
    case $pr_limit in ''|*[!0-9]*) pr_limit=20 ;; esac

    tuxedo_respawn_pr_dashboard() {
        window_name="$1"
        script_name="$2"
        tmux respawn-pane -k -t "$SESSION_NAME:$window_name.0" "sh -lc 'while true; do output=\$(\"$SCRIPT_DIR/scripts/$script_name\" --limit $pr_limit 2>&1 || true); printf \"\\033[H\\033[2J\\033[3J\"; printf \"%s\\n\" \"\$output\"; sleep $refresh_seconds; done'" 2>/dev/null || true
    }

    tuxedo_respawn_pr_dashboard "$OPEN_PRS_WINDOW_NAME" "listOpenPrs.sh"
    tuxedo_respawn_pr_dashboard "$CLOSED_PRS_WINDOW_NAME" "listRecentClosedPrs.sh"
}

tuxedo_prepare_shared_dirs() {
    if [ -d "$SHARED_DIR" ]; then
        mkdir -p "$SHARED_DIR/.test_files" "$SHARED_DIR/.secrets" "$SHARED_DIR/packages/api"

        # Touch package-specific env files if they don't exist
        [ -f "$SHARED_DIR/packages/api/.env" ] || touch "$SHARED_DIR/packages/api/.env"

        ensure_symlinks "$MAIN_DIR"
        i=$WORKSPACE_START
        while [ "$i" -le "$NUM_WORKSPACES" ]; do
            ensure_symlinks "$BASE_DIR/${WORKSPACE_PREFIX}${i}"
            i=$((i + 1))
        done
    fi
}

tuxedo_attach_or_create() {
    if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        tuxedo_start_pr_dashboards
        # Sync VS Code titles before attaching
        sync_all_titles
        tmux attach-session -t "$SESSION_NAME"
        return 0
    fi

    # Create dedicated PR windows first (no editor split panes).
    # These open in DASHBOARD_DIR (the canonical tearleads repo for PR operations).
    # Don't set @workspace so status bar shows window name (open-prs, closed-prs).
    dashboard_path=$(workspace_path "$DASHBOARD_DIR")
    tmux -f "$TMUX_CONF" new-session -d -s "$SESSION_NAME" -c "$DASHBOARD_DIR" -n "$OPEN_PRS_WINDOW_NAME" -e "PATH=$dashboard_path" -e "TUXEDO_WORKSPACE=$DASHBOARD_DIR"
    tmux new-window -t "$SESSION_NAME:" -c "$DASHBOARD_DIR" -n "$CLOSED_PRS_WINDOW_NAME" -e "PATH=$dashboard_path" -e "TUXEDO_WORKSPACE=$DASHBOARD_DIR"

    # Add shared workspace as third window (source of truth).
    # Terminal pane runs in a persistent screen session.
    shared_window_name="${WORKSPACE_PREFIX}-shared"
    screen_shared=$(screen_cmd tux-shared)
    shared_path=$(workspace_path "$SHARED_DIR")
    if [ -n "$screen_shared" ]; then
        tmux new-window -t "$SESSION_NAME:" -c "$SHARED_DIR" -n "$shared_window_name" -e "PATH=$shared_path" -e "TUXEDO_WORKSPACE=$SHARED_DIR" "$screen_shared"
    else
        tmux new-window -t "$SESSION_NAME:" -c "$SHARED_DIR" -n "$shared_window_name" -e "PATH=$shared_path" -e "TUXEDO_WORKSPACE=$SHARED_DIR"
    fi
    set_window_title_options "$SHARED_DIR" "$shared_window_name"
    tmux split-window -h -t "$SESSION_NAME:$shared_window_name" -c "$SHARED_DIR" -e "PATH=$shared_path" -e "TUXEDO_WORKSPACE=$SHARED_DIR" "$EDITOR"

    # Add main workspace as second window
    # Note: Use "$SESSION_NAME:" (with colon) to explicitly target the session,
    # avoiding tmux confusion when window names share a prefix with the session name
    main_window_name="${WORKSPACE_PREFIX}-main"
    main_path=$(workspace_path "$MAIN_DIR")
    screen_main=$(screen_cmd tux-main)
    if [ -n "$screen_main" ]; then
        tmux new-window -t "$SESSION_NAME:" -c "$MAIN_DIR" -n "$main_window_name" -e "PATH=$main_path" -e "TUXEDO_WORKSPACE=$MAIN_DIR" "$screen_main"
    else
        tmux new-window -t "$SESSION_NAME:" -c "$MAIN_DIR" -n "$main_window_name" -e "PATH=$main_path" -e "TUXEDO_WORKSPACE=$MAIN_DIR"
    fi
    set_window_title_options "$MAIN_DIR" "$main_window_name"
    tmux split-window -h -t "$SESSION_NAME:$main_window_name" -c "$MAIN_DIR" -e "PATH=$main_path" -e "TUXEDO_WORKSPACE=$MAIN_DIR" "$EDITOR"

    i=$WORKSPACE_START
    while [ "$i" -le "$NUM_WORKSPACES" ]; do
        workspace_dir="$BASE_DIR/${WORKSPACE_PREFIX}${i}"
        window_name="${WORKSPACE_PREFIX}${i}"
        ws_path=$(workspace_path "$workspace_dir")
        # Zero-pad screen session names to avoid prefix collisions (tux-2 vs tux-20)
        screen_name=$(printf "tux-%02d" "$i")
        screen_i=$(screen_cmd "$screen_name")
        if [ -n "$screen_i" ]; then
            tmux new-window -t "$SESSION_NAME:" -c "$workspace_dir" -n "$window_name" -e "PATH=$ws_path" -e "TUXEDO_WORKSPACE=$workspace_dir" "$screen_i"
        else
            tmux new-window -t "$SESSION_NAME:" -c "$workspace_dir" -n "$window_name" -e "PATH=$ws_path" -e "TUXEDO_WORKSPACE=$workspace_dir"
        fi
        set_window_title_options "$workspace_dir" "$window_name"
        tmux split-window -h -t "$SESSION_NAME:$window_name" -c "$workspace_dir" -e "PATH=$ws_path" -e "TUXEDO_WORKSPACE=$workspace_dir" "$EDITOR"
        i=$((i + 1))
    done

    tuxedo_start_pr_dashboards

    # Note: Don't call sync_all_titles here - windows already have correct @workspace
    # from set_window_title_options calls above. sync_all_titles is only for reattaching
    # to existing sessions where we need to infer workspace from pane_current_path.

    tmux select-window -t "$SESSION_NAME:$OPEN_PRS_WINDOW_NAME" 2>/dev/null || true
    tmux attach-session -t "$SESSION_NAME"
}

tuxedo_main() {
    if [ "${TUXEDO_SKIP_MAIN:-}" = "1" ]; then
        return 0 2>/dev/null || exit 0
    fi

    tuxedo_set_screen_flag

    # Update workspaces that are on main with no uncommitted changes FIRST
    # This ensures .gitignore changes are pulled before symlinks are created
    update_all_workspaces

    # Enforce symlinks for all workspaces after updating from main
    tuxedo_prepare_shared_dirs

    tuxedo_attach_or_create
}
