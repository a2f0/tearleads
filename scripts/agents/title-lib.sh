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
    title="$1"

    [ -n "${TMUX:-}" ] || return 0

    tmux rename-window "$title" 2>/dev/null || true
}
