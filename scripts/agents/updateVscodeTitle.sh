#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

BRANCH=$(git branch --show-current)

if [ "$BRANCH" = "main" ]; then
    "$SCRIPT_DIR/../setVscodeTitle.sh" "ready"
else
    # Check if a PR exists for this branch
    PR_NUM=$(gh pr view --json number -q .number 2>/dev/null || true)
    if [ -n "$PR_NUM" ]; then
        "$SCRIPT_DIR/../setVscodeTitle.sh" "#$PR_NUM - $BRANCH"
    else
        "$SCRIPT_DIR/../setVscodeTitle.sh" "$BRANCH"
    fi
fi
