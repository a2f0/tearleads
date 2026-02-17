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
    # No-op: tmux window titles now update automatically via automatic-rename-format
    # in tmux.conf, which uses the @workspace window option to get the git branch.
    # This function is preserved for backward compatibility with setVscodeTitle.ts.
    :
}
