#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VSCODE_DIR="$REPO_ROOT/.vscode"
SETTINGS_FILE="$VSCODE_DIR/settings.json"

usage() {
    echo "Usage: $0 <title>"
    echo ""
    echo "Sets the VS Code window title for this workspace."
    echo ""
    echo "Examples:"
    echo "  $0 \"My Project\""
    echo "  $0 \"rapid5 - \${activeEditorShort}\""
    echo ""
    echo "Available variables:"
    echo "  \${rootName}          - workspace/folder name"
    echo "  \${activeEditorShort} - current file name"
    echo "  \${activeEditorLong}  - full file path"
    echo "  \${dirty}             - unsaved indicator"
    echo "  \${appName}           - VS Code"
    exit 1
}

if [ $# -eq 0 ]; then
    usage
fi

TITLE="$1"

mkdir -p "$VSCODE_DIR"

if [ -f "$SETTINGS_FILE" ] && command -v jq >/dev/null 2>&1; then
    # Merge with existing settings using jq
    TEMP_FILE=$(mktemp)
    jq --arg title "$TITLE" '.["window.title"] = $title' "$SETTINGS_FILE" > "$TEMP_FILE"
    mv "$TEMP_FILE" "$SETTINGS_FILE"
    echo "Updated window.title in $SETTINGS_FILE"
elif [ -f "$SETTINGS_FILE" ]; then
    # Settings exist but no jq - warn user
    echo "Warning: $SETTINGS_FILE exists but jq is not installed."
    echo "Please manually add: \"window.title\": \"$TITLE\""
    exit 1
else
    # Create new settings file
    cat > "$SETTINGS_FILE" << EOF
{
  "window.title": "$TITLE"
}
EOF
    echo "Created $SETTINGS_FILE"
fi

echo "VS Code window title set to: $TITLE"
