#!/bin/sh
# Tag a PR with the current tuxedo instance name.
# Removes any existing tuxedo:* labels and adds tuxedo:<instance>.
# Usage: tagPrWithTuxedoInstance.sh [--pr <number>]
set -eu

usage() {
    cat <<'EOF'
Usage: tagPrWithTuxedoInstance.sh [--pr <number>]

Tags the PR with the current tuxedo instance (workspace folder name).
Removes any existing tuxedo:* labels before adding the new one.

Options:
  --pr <number>   PR number (auto-detected from current branch if omitted)
  -h, --help      Show help
EOF
}

PR_NUMBER=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --pr)
            shift
            if [ -z "${1:-}" ]; then
                echo "Error: --pr requires a value." >&2
                exit 1
            fi
            PR_NUMBER="$1"
            ;;
        *)
            echo "Error: Unknown option '$1'." >&2
            usage >&2
            exit 1
            ;;
    esac
    shift
done

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "Error: Not in a git repository." >&2
    exit 1
}

INSTANCE_NAME=$(basename "$REPO_ROOT")

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) || {
    echo "Error: Could not determine repository." >&2
    exit 1
}

if [ -z "$PR_NUMBER" ]; then
    PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null) || {
        echo "Error: No PR found for current branch. Use --pr to specify." >&2
        exit 1
    }
fi

case "$PR_NUMBER" in
    ''|*[!0-9]*|0)
        echo "Error: Invalid PR number '$PR_NUMBER'." >&2
        exit 1
        ;;
esac

NEW_LABEL="tuxedo:$INSTANCE_NAME"

CURRENT_LABELS=$(gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' -R "$REPO" 2>/dev/null || echo "")

OLD_TUXEDO_LABELS=$(echo "$CURRENT_LABELS" | grep '^tuxedo:' || true)

if [ "$(echo "$OLD_TUXEDO_LABELS" | grep -c .)" -eq 1 ] && [ "$OLD_TUXEDO_LABELS" = "$NEW_LABEL" ]; then
    echo "Label '$NEW_LABEL' is already the only tuxedo label on PR #$PR_NUMBER."
    exit 0
fi

for OLD_LABEL in $OLD_TUXEDO_LABELS; do
    gh pr edit "$PR_NUMBER" --remove-label "$OLD_LABEL" -R "$REPO" 2>/dev/null || true
    echo "Removed label '$OLD_LABEL' from PR #$PR_NUMBER."
done

REPO_LABELS=$(gh label list --json name --jq '.[].name' -R "$REPO" 2>/dev/null || echo "")
if ! echo "$REPO_LABELS" | grep -qxF "$NEW_LABEL"; then
    gh label create "$NEW_LABEL" --description "Tuxedo instance: $INSTANCE_NAME" --color "1D76DB" -R "$REPO" 2>/dev/null || true
    echo "Created label '$NEW_LABEL'."
fi

gh pr edit "$PR_NUMBER" --add-label "$NEW_LABEL" -R "$REPO"

VERIFY=$(gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' -R "$REPO")
if echo "$VERIFY" | grep -qxF "$NEW_LABEL"; then
    echo "Tagged PR #$PR_NUMBER with '$NEW_LABEL'."
else
    echo "Error: Failed to add label '$NEW_LABEL' to PR #$PR_NUMBER." >&2
    exit 1
fi
