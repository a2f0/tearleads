#!/bin/sh

# Shared helpers for tuxedo.sh

tuxedo_init() {
    SCRIPT_DIR="$1"
    CONFIG_DIR="$SCRIPT_DIR/config"
    GHOSTTY_CONF="$CONFIG_DIR/ghostty.conf"

    BASE_DIR="${TUXEDO_BASE_DIR:-$HOME/tuxedo}"
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
    # Directory for PR dashboards (uses main workspace as canonical repo)
    DASHBOARD_DIR="${TUXEDO_DASHBOARD_DIR:-$BASE_DIR/${WORKSPACE_PREFIX}-main}"

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

}

tuxedo_set_inner_tmux_flag() {
    if [ "${TUXEDO_FORCE_NO_INNER_TMUX:-}" = "1" ]; then
        USE_INNER_TMUX=false
        return 0
    fi

    # Inner tmux is always available since we're already running tmux
    USE_INNER_TMUX=true
}

# Inner tmux socket name for nested sessions
INNER_TMUX_SOCKET="tuxedo-inner"

# Get command to start/attach inner tmux session for a workspace
# Returns the command to run in an outer tmux pane
# Uses escaped $PATH and $TUXEDO_WORKSPACE so they expand at runtime in the outer pane
inner_tmux_cmd() {
    session_name="$1"
    work_dir="${2:-}"
    if [ "$USE_INNER_TMUX" = true ]; then
        # Attach to existing session or create new one, passing through PATH and TUXEDO_WORKSPACE
        if [ -n "$work_dir" ]; then
            echo "tmux -L $INNER_TMUX_SOCKET -f \"$CONFIG_DIR/tmux-inner.conf\" new-session -A -s $session_name -c \"$work_dir\" -e \"PATH=\$PATH\" -e \"TUXEDO_WORKSPACE=\$TUXEDO_WORKSPACE\""
        else
            echo "tmux -L $INNER_TMUX_SOCKET -f \"$CONFIG_DIR/tmux-inner.conf\" new-session -A -s $session_name -e \"PATH=\$PATH\" -e \"TUXEDO_WORKSPACE=\$TUXEDO_WORKSPACE\""
        fi
    else
        # Fallback: outer tmux will start default shell
        echo ""
    fi
}

# Set up editor split in an inner tmux session (called after all windows created)
inner_tmux_setup_editor() {
    [ "$USE_INNER_TMUX" = true ] || return 0

    session_name="$1"
    editor_cmd="$2"
    work_dir="${3:-}"

    # Wait for session to exist (poll up to 5 seconds)
    tries=0
    while [ $tries -lt 50 ]; do
        if tmux -L "$INNER_TMUX_SOCKET" has-session -t "$session_name" 2>/dev/null; then
            # Found it - split and run editor in workspace directory (-d keeps terminal active)
            if [ -n "$work_dir" ]; then
                tmux -L "$INNER_TMUX_SOCKET" split-window -d -h -t "$session_name" -c "$work_dir" "$editor_cmd"
            else
                tmux -L "$INNER_TMUX_SOCKET" split-window -d -h -t "$session_name" "$editor_cmd"
            fi
            return 0
        fi
        sleep 0.1
        tries=$((tries + 1))
    done
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
    # Use while read to handle window names with spaces correctly
    tmux list-windows -t "$SESSION_NAME" -F '#{window_name}' 2>/dev/null | while IFS= read -r win; do
        [ -z "$win" ] && continue

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
    echo "$workspace/scripts:$workspace/scripts/agents:$SCRIPT_DIR/scripts:$BASE_PATH"
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
        tmux respawn-pane -k -c "$DASHBOARD_DIR" -t "$SESSION_NAME:$window_name.0" "sh -lc 'while true; do output=\$(\"$SCRIPT_DIR/scripts/$script_name\" --limit $pr_limit 2>&1 || true); printf \"\\033[H\\033[2J\\033[3J\"; printf \"%s\\n\" \"\$output\"; sleep $refresh_seconds; done'" 2>/dev/null || true
    }

    tuxedo_respawn_pr_dashboard "$OPEN_PRS_WINDOW_NAME" "listOpenPrs.sh"
    tuxedo_respawn_pr_dashboard "$CLOSED_PRS_WINDOW_NAME" "listRecentClosedPrs.sh"
}

tuxedo_prepare_shared_dirs() {
    if [ -d "$SHARED_DIR" ]; then
        mkdir -p "$SHARED_DIR/.test_files" "$SHARED_DIR/.secrets"

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

    # Collect inner tmux session names for editor setup later
    inner_sessions_for_editor=""

    # Add shared workspace as third window (source of truth).
    # Runs inner tmux session with editor in right pane.
    shared_window_name="${WORKSPACE_PREFIX}-shared"
    inner_shared=$(inner_tmux_cmd tux-shared "$SHARED_DIR")
    shared_path=$(workspace_path "$SHARED_DIR")
    if [ -n "$inner_shared" ]; then
        tmux new-window -t "$SESSION_NAME:" -c "$SHARED_DIR" -n "$shared_window_name" -e "PATH=$shared_path" -e "TUXEDO_WORKSPACE=$SHARED_DIR" -e "TUXEDO_INNER_CONF=$CONFIG_DIR/tmux-inner.conf" "$inner_shared"
        inner_sessions_for_editor="$inner_sessions_for_editor tux-shared:$SHARED_DIR"
    else
        tmux new-window -t "$SESSION_NAME:" -c "$SHARED_DIR" -n "$shared_window_name" -e "PATH=$shared_path" -e "TUXEDO_WORKSPACE=$SHARED_DIR"
        tmux split-window -d -h -t "$SESSION_NAME:$shared_window_name" -c "$SHARED_DIR" -e "PATH=$shared_path" -e "TUXEDO_WORKSPACE=$SHARED_DIR" "$EDITOR"
    fi
    set_window_title_options "$SHARED_DIR" "$shared_window_name"

    # Add main workspace as second window
    # Note: Use "$SESSION_NAME:" (with colon) to explicitly target the session,
    # avoiding tmux confusion when window names share a prefix with the session name
    main_window_name="${WORKSPACE_PREFIX}-main"
    main_path=$(workspace_path "$MAIN_DIR")
    inner_main=$(inner_tmux_cmd tux-main "$MAIN_DIR")
    if [ -n "$inner_main" ]; then
        tmux new-window -t "$SESSION_NAME:" -c "$MAIN_DIR" -n "$main_window_name" -e "PATH=$main_path" -e "TUXEDO_WORKSPACE=$MAIN_DIR" -e "TUXEDO_INNER_CONF=$CONFIG_DIR/tmux-inner.conf" "$inner_main"
        inner_sessions_for_editor="$inner_sessions_for_editor tux-main:$MAIN_DIR"
    else
        tmux new-window -t "$SESSION_NAME:" -c "$MAIN_DIR" -n "$main_window_name" -e "PATH=$main_path" -e "TUXEDO_WORKSPACE=$MAIN_DIR"
        tmux split-window -d -h -t "$SESSION_NAME:$main_window_name" -c "$MAIN_DIR" -e "PATH=$main_path" -e "TUXEDO_WORKSPACE=$MAIN_DIR" "$EDITOR"
    fi
    set_window_title_options "$MAIN_DIR" "$main_window_name"

    i=$WORKSPACE_START
    while [ "$i" -le "$NUM_WORKSPACES" ]; do
        workspace_dir="$BASE_DIR/${WORKSPACE_PREFIX}${i}"
        window_name="${WORKSPACE_PREFIX}${i}"
        ws_path=$(workspace_path "$workspace_dir")
        # Zero-pad session names to avoid prefix collisions (tux-2 vs tux-20)
        inner_name=$(printf "tux-%02d" "$i")
        inner_i=$(inner_tmux_cmd "$inner_name" "$workspace_dir")
        if [ -n "$inner_i" ]; then
            tmux new-window -t "$SESSION_NAME:" -c "$workspace_dir" -n "$window_name" -e "PATH=$ws_path" -e "TUXEDO_WORKSPACE=$workspace_dir" -e "TUXEDO_INNER_CONF=$CONFIG_DIR/tmux-inner.conf" "$inner_i"
            inner_sessions_for_editor="$inner_sessions_for_editor $inner_name:$workspace_dir"
        else
            tmux new-window -t "$SESSION_NAME:" -c "$workspace_dir" -n "$window_name" -e "PATH=$ws_path" -e "TUXEDO_WORKSPACE=$workspace_dir"
            tmux split-window -d -h -t "$SESSION_NAME:$window_name" -c "$workspace_dir" -e "PATH=$ws_path" -e "TUXEDO_WORKSPACE=$workspace_dir" "$EDITOR"
        fi
        set_window_title_options "$workspace_dir" "$window_name"
        i=$((i + 1))
    done

    # Set up editor splits in all inner tmux sessions (in background, after windows created)
    # Format: "session_name:workspace_dir" pairs
    if [ -n "$inner_sessions_for_editor" ]; then
        (
            for entry in $inner_sessions_for_editor; do
                sname="${entry%%:*}"
                wdir="${entry#*:}"
                inner_tmux_setup_editor "$sname" "$EDITOR" "$wdir"
            done
        ) &
    fi

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

    tuxedo_set_inner_tmux_flag

    # Enforce symlinks for all workspaces
    tuxedo_prepare_shared_dirs

    tuxedo_attach_or_create
}
