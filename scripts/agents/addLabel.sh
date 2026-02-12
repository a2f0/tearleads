#!/bin/sh
# Add a label to a PR or issue.
# Usage: addLabel.sh --type pr|issue --number <n> --label <name>
set -eu

usage() {
    cat <<'EOF'
Usage: addLabel.sh --type pr|issue --number <n> --label <name>

Options:
  --type <pr|issue>   Target type (required)
  --number <n>        PR or issue number (required)
  --label <name>      Label to add (required)
  -h, --help          Show help
EOF
}

require_value() {
    opt="$1"
    val="$2"
    if [ -z "$val" ]; then
        echo "Error: $opt requires a value." >&2
        exit 1
    fi
}

TYPE=""
NUMBER=""
LABEL=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --type)
            shift
            require_value "--type" "${1:-}"
            TYPE="$1"
            ;;
        --number)
            shift
            require_value "--number" "${1:-}"
            NUMBER="$1"
            ;;
        --label)
            shift
            require_value "--label" "${1:-}"
            LABEL="$1"
            ;;
        *)
            echo "Error: Unknown option '$1'." >&2
            usage >&2
            exit 1
            ;;
    esac
    shift
done

if [ -z "$TYPE" ]; then
    echo "Error: --type is required." >&2
    usage >&2
    exit 1
fi

if [ -z "$NUMBER" ]; then
    echo "Error: --number is required." >&2
    usage >&2
    exit 1
fi

if [ -z "$LABEL" ]; then
    echo "Error: --label is required." >&2
    usage >&2
    exit 1
fi

case "$TYPE" in
    pr|issue) ;;
    *)
        echo "Error: --type must be 'pr' or 'issue'." >&2
        exit 1
        ;;
esac

case "$NUMBER" in
    ''|*[!0-9]*)
        echo "Error: --number must be a positive integer." >&2
        exit 1
        ;;
esac

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

if [ "$TYPE" = "pr" ]; then
    CURRENT_LABELS=$(gh pr view "$NUMBER" --json labels --jq '.labels[].name' -R "$REPO" 2>/dev/null || echo "")
    if echo "$CURRENT_LABELS" | grep -qxF "$LABEL"; then
        echo "Label '$LABEL' already present on PR #$NUMBER."
        exit 0
    fi
    gh pr edit "$NUMBER" --add-label "$LABEL" -R "$REPO"
    VERIFY=$(gh pr view "$NUMBER" --json labels --jq '.labels[].name' -R "$REPO")
else
    CURRENT_LABELS=$(gh issue view "$NUMBER" --json labels --jq '.labels[].name' -R "$REPO" 2>/dev/null || echo "")
    if echo "$CURRENT_LABELS" | grep -qxF "$LABEL"; then
        echo "Label '$LABEL' already present on issue #$NUMBER."
        exit 0
    fi
    gh issue edit "$NUMBER" --add-label "$LABEL" -R "$REPO"
    VERIFY=$(gh issue view "$NUMBER" --json labels --jq '.labels[].name' -R "$REPO")
fi

if echo "$VERIFY" | grep -qxF "$LABEL"; then
    echo "Added label '$LABEL' to $TYPE #$NUMBER."
else
    echo "Error: Failed to add label '$LABEL' to $TYPE #$NUMBER." >&2
    exit 1
fi
