#!/bin/sh
# Mark workspace as waiting for user input: updates VS Code title and tmux window name.
# Skips if already in queued state (queued takes precedence).
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if command -v git >/dev/null 2>&1 && git -C "${PWD}" rev-parse --show-toplevel >/dev/null 2>&1; then
    REPO_ROOT=$(git -C "$PWD" rev-parse --show-toplevel)
else
    REPO_ROOT="$SCRIPT_REPO_ROOT"
fi
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
    echo "Already in queued state, skipping waiting status"
    exit 0
fi

# Get current base title (without any status prefix)
get_base_title() {
    if [ -f "$SETTINGS_FILE" ] && command -v jq >/dev/null 2>&1; then
        CURRENT=$(jq -r '.["window.title"] // ""' "$SETTINGS_FILE" 2>/dev/null || true)
        # Strip any existing status prefix
        case "$CURRENT" in
            "(working) "*|"(waiting) "*|"(queued) "*) echo "${CURRENT#* }" ;;
            *)             echo "$CURRENT" ;;
        esac
    else
        # Auto-detect from git
        cd "$REPO_ROOT"
        BRANCH=$(git branch --show-current)
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
    fi
}

BASE_TITLE=$(get_base_title)
NEW_TITLE="(waiting) $BASE_TITLE"

# Update VS Code title
"$SCRIPT_DIR/setVscodeTitle.sh" "$NEW_TITLE"

# Update tmux window if we're in a tmux session
if [ -n "${TMUX:-}" ]; then
    CURRENT_WINDOW=$(tmux display-message -p '#I')
    CURRENT_NAME=$(tmux display-message -p '#W')

    # Get base name (strip any status prefix)
    case "$CURRENT_NAME" in
        "(working) "*|"(waiting) "*|"(queued) "*)
            BASE_NAME="${CURRENT_NAME#* }"
            ;;
        *)
            BASE_NAME="$CURRENT_NAME"
            ;;
    esac

    # Store original name if not already stored
    STORED_NAME=$(tmux show-option -wqv @original_name 2>/dev/null || true)
    if [ -z "$STORED_NAME" ]; then
        tmux set-option -w @original_name "$BASE_NAME"
    fi

    # Clear working status, set waiting status
    tmux set-option -wu @working_status 2>/dev/null || true
    tmux set-option -w @waiting_status "true"

    # Rename window with waiting prefix
    tmux rename-window "(waiting) $BASE_NAME"

    echo "Tmux window marked as waiting"
fi
