#!/bin/sh

agent_repo_root() {
    git rev-parse --show-toplevel
}

agent_current_branch() {
    repo_root="$1"
    branch=$(git -C "$repo_root" branch --show-current 2>/dev/null || true)
    if [ -z "$branch" ]; then
        branch=$(git -C "$repo_root" rev-parse --short HEAD 2>/dev/null || echo "unknown")
    fi
    printf '%s\n' "$branch"
}

agent_workspace_title() {
    repo_root="$1"
    project_name=$(basename "$repo_root")
    printf '%s\n' "$project_name"
}

agent_sync_tmux_title() {
    # Disabled: tmux rename-window renames the FOCUSED window, not the window
    # associated with this workspace. This caused title pollution when agents
    # in different workspaces ran concurrently. The pane border in tmux.conf
    # already shows the correct path:branch dynamically.
    :
}
