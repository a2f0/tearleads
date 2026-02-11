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
    branch=$(agent_current_branch "$repo_root")
    printf '%s - %s\n' "$project_name" "$branch"
}

agent_sync_tmux_title() {
    title="$1"

    [ -n "${TMUX:-}" ] || return 0

    tmux rename-window "$title" 2>/dev/null || true
    tmux set-option -wu @original_name 2>/dev/null || true
    tmux set-option -wu @working_status 2>/dev/null || true
    tmux set-option -wu @waiting_status 2>/dev/null || true
    tmux set-option -wu @queued_status 2>/dev/null || true
}
