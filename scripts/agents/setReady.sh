#!/bin/sh
# Mark workspace as ready: updates VS Code title and tmux window name.
# Skips if already in queued state (queued takes precedence).
# Does NOT set orange working status - use setWorking.sh for that.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/repoRoot.sh"
SETTINGS_FILE="$REPO_ROOT/.vscode/settings.json"

# Check if already queued (queued takes precedence)
is_queued() {
    # Check VS Code title
    if [ -f "$SETTINGS_FILE" ] && command -v jq >/dev/null 2>&1; then
        CURRENT_TITLE=$(jq -r '.["window.title"] // ""' "$SETTINGS_FILE" 2>/dev/null || true)
        case "$CURRENT_TITLE" in
            "(queued)"*) return 0 ;;
        esac
    fi
    # Check tmux window option
    if [ -n "${TMUX:-}" ]; then
        QUEUED_STATUS=$(tmux show-option -wqv @queued_status 2>/dev/null || true)
        if [ "$QUEUED_STATUS" = "true" ]; then
            return 0
        fi
    fi
    return 1
}

if is_queued; then
    echo "Already in queued state, skipping ready status"
    exit 0
fi

# Get title based on git state (runs in subshell to isolate cd)
get_title() {
    (
        cd "$REPO_ROOT"
        BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
        if [ "$BRANCH" = "main" ]; then
            echo "ready"
        else
            PR_NUM=$(gh pr view --json number -q .number 2>/dev/null || true)
            if [ -n "$PR_NUM" ]; then
                echo "#$PR_NUM - $BRANCH"
            else
                echo "$BRANCH"
            fi
        fi
    )
}

TITLE=$(get_title)

# Update VS Code title (no prefix)
"$SCRIPT_DIR/setVscodeTitle.sh" "$TITLE"

# Update tmux window if we're in a tmux session
if [ -n "${TMUX:-}" ]; then
    # Clear all status flags
    tmux set-option -wu @working_status 2>/dev/null || true
    tmux set-option -wu @waiting_status 2>/dev/null || true
    tmux set-option -wu @original_name 2>/dev/null || true

    # Rename window to the new title (consistent with VS Code)
    tmux rename-window "$TITLE"

    echo "Tmux window marked as ready"
fi
