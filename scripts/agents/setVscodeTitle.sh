#!/bin/sh
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

# shellcheck disable=SC1091
. "$SCRIPT_DIR/title-lib.sh"

REPO_ROOT="$(agent_repo_root)"
VSCODE_DIR="$REPO_ROOT/.vscode"
SETTINGS_FILE="$VSCODE_DIR/settings.json"
TITLE="$(agent_workspace_title "$REPO_ROOT")"

usage() {
    echo "Usage: $0 [--title <value> | <value>]"
    echo ""
    echo "Sets VS Code window title."
    echo "Default title: '<workspace>'"
    echo "With --title or a positional value: uses that exact title."
    exit 0
}

TITLE_OVERRIDE=""

while [ "$#" -gt 0 ]; do
    case "${1:-}" in
        -h|--help)
            usage
            ;;
        --title)
            shift
            if [ -z "${1:-}" ]; then
                echo "Error: --title requires a value." >&2
                exit 1
            fi
            TITLE_OVERRIDE="$1"
            ;;
        *)
            if [ -n "$TITLE_OVERRIDE" ]; then
                echo "Error: Unexpected argument '$1'. Use -h for help." >&2
                exit 1
            fi
            TITLE_OVERRIDE="$1"
            ;;
    esac
    shift
done

if [ -n "$TITLE_OVERRIDE" ]; then
    TITLE="$TITLE_OVERRIDE"
else
    TITLE="$(agent_workspace_title "$REPO_ROOT")"
fi

mkdir -p "$VSCODE_DIR"

if command -v jq >/dev/null 2>&1; then
    if [ -f "$SETTINGS_FILE" ]; then
        TEMP_FILE=$(mktemp "${TMPDIR:-/tmp}/setVscodeTitle.XXXXXX")
        trap 'rm -f "$TEMP_FILE"' EXIT
        if jq --arg title "$TITLE" '.["window.title"] = $title' "$SETTINGS_FILE" > "$TEMP_FILE"; then
            mv "$TEMP_FILE" "$SETTINGS_FILE"
        else
            echo "Error: Failed to update $SETTINGS_FILE with jq." >&2
            exit 1
        fi
        trap - EXIT
    else
        if ! jq -n --arg title "$TITLE" '{ "window.title": $title }' > "$SETTINGS_FILE"; then
            echo "Error: Failed to create $SETTINGS_FILE with jq." >&2
            exit 1
        fi
    fi
else
    if [ -f "$SETTINGS_FILE" ]; then
        echo "Warning: $SETTINGS_FILE exists but 'jq' is not installed. Cannot merge automatically." >&2
        echo "Please manually add or update: \"window.title\": \"$TITLE\"" >&2
        exit 1
    fi

    if printf '%s' "$TITLE" | grep -q '["\\]'; then
        printf "Warning: Title contains special characters ('\"' or '\\') and 'jq' is not installed.\n" >&2
        echo "Cannot reliably create $SETTINGS_FILE." >&2
        echo "Please install 'jq' or create the file manually." >&2
        exit 1
    fi

    cat > "$SETTINGS_FILE" << EOT
{
  "window.title": "$TITLE"
}
EOT
fi

echo "Window title set to: $TITLE"
