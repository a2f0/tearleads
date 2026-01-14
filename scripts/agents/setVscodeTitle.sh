#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if command -v git >/dev/null 2>&1 && git -C "${PWD}" rev-parse --show-toplevel >/dev/null 2>&1; then
    REPO_ROOT=$(git -C "$PWD" rev-parse --show-toplevel)
else
    REPO_ROOT="$SCRIPT_REPO_ROOT"
fi

VSCODE_DIR="$REPO_ROOT/.vscode"
SETTINGS_FILE="$VSCODE_DIR/settings.json"

usage() {
    echo "Usage: $0 [title]"
    echo ""
    echo "Sets the VS Code window title for this workspace."
    echo ""
    echo "If no title is provided, auto-detects based on current branch:"
    echo "  - On main: sets title to 'ready'"
    echo "  - On branch with PR: sets title to '#<pr-number> - <branch>'"
    echo "  - On branch without PR: sets title to '<branch>'"
    echo ""
    echo "Examples:"
    echo "  $0                              # auto-detect"
    echo "  $0 \"My Project\""
    echo "  $0 \"(queued) #123 - feature\""
    echo ""
    echo "Available VS Code variables:"
    echo "  \${rootName}          - workspace/folder name"
    echo "  \${activeEditorShort} - current file name"
    echo "  \${activeEditorLong}  - full file path"
    echo "  \${dirty}             - unsaved indicator"
    echo "  \${appName}           - VS Code"
    exit 1
}

# Handle help flag
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
fi

# Get project directory name (e.g., rapid, rapid2, rapid-main)
PROJECT_NAME=$(basename "$REPO_ROOT")

# Determine title
if [ "$#" -eq 0 ]; then
    # Auto-detect based on branch/PR
    cd "$REPO_ROOT"
    BRANCH=$(git branch --show-current)

    if [ "$BRANCH" = "main" ]; then
        TITLE="$PROJECT_NAME - ready"
    else
        # Check if a PR exists for this branch
        PR_NUM=$(gh pr view --json number -q .number 2>/dev/null || true)
        if [ -n "$PR_NUM" ]; then
            TITLE="$PROJECT_NAME - #$PR_NUM - $BRANCH"
        else
            TITLE="$PROJECT_NAME - $BRANCH"
        fi
    fi
else
    # For manual titles, still prefix with project name unless already prefixed
    if printf '%s' "$1" | grep -q "^$PROJECT_NAME"; then
        TITLE="$1"
    else
        TITLE="$PROJECT_NAME - $1"
    fi
fi

# Set the VS Code title
mkdir -p "$VSCODE_DIR"

if command -v jq >/dev/null 2>&1; then
    # jq is available, use it for robust JSON handling
    if [ -f "$SETTINGS_FILE" ]; then
        # Merge with existing settings
        TEMP_FILE=$(mktemp "${TMPDIR:-/tmp}/setVscodeTitle.XXXXXX")
        trap 'rm -f "$TEMP_FILE"' EXIT
        if jq --arg title "$TITLE" '.["window.title"] = $title' "$SETTINGS_FILE" > "$TEMP_FILE"; then
            mv "$TEMP_FILE" "$SETTINGS_FILE"
        else
            echo "Error: Failed to update $SETTINGS_FILE with jq." >&2
            exit 1
        fi
        trap - EXIT
        echo "Updated window.title in $SETTINGS_FILE"
    else
        # Create new settings file
        if ! jq -n --arg title "$TITLE" '{ "window.title": $title }' > "$SETTINGS_FILE"; then
            echo "Error: Failed to create $SETTINGS_FILE with jq." >&2
            exit 1
        fi
        echo "Created $SETTINGS_FILE"
    fi
else
    # jq is not available, proceed with caution
    if [ -f "$SETTINGS_FILE" ]; then
        echo "Warning: $SETTINGS_FILE exists but 'jq' is not installed. Cannot merge automatically." >&2
        echo "Please manually add or update: \"window.title\": \"$TITLE\"" >&2
        exit 1
    else
        # Creating a new file without jq. Check for characters that would break JSON
        if printf '%s' "$TITLE" | grep -q '["\\]'; then
            printf "Warning: Title contains special characters ('\"' or '\\') and 'jq' is not installed.\n" >&2
            echo "Cannot reliably create $SETTINGS_FILE." >&2
            echo "Please install 'jq' or create the file manually." >&2
            exit 1
        fi
        # Create new settings file (safe for simple titles)
        cat > "$SETTINGS_FILE" << EOF
{
  "window.title": "$TITLE"
}
EOF
        echo "Created $SETTINGS_FILE"
    fi
fi

echo "VS Code window title set to: $TITLE"
