#!/bin/sh
set -eu

# Solicit a code review from Codex for the current PR/branch
# Output goes to stdout for consumption by other agents

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

cd "$ROOT_DIR"

# Get current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ "$BRANCH" = "main" ]; then
  echo "Error: Cannot review main branch. Checkout a PR branch first." >&2
  exit 1
fi

# Check if there's an associated PR
PR_NUMBER=$(gh pr view --json number -q .number 2>/dev/null || echo "")

if [ -z "$PR_NUMBER" ]; then
  echo "Error: No PR found for branch '$BRANCH'. Create a PR first." >&2
  exit 1
fi

# Ensure there are changes against main
DIFF=$(git diff main...HEAD)

if [ -z "$DIFF" ]; then
  echo "Error: No changes found between main and current branch." >&2
  exit 1
fi

# Run Codex review in non-interactive mode (outputs to stdout)
# --base and [PROMPT] are mutually exclusive; use --base for the diff, --title for context
"$ROOT_DIR/scripts/codex.sh" review --base main --title "PR #$PR_NUMBER ($BRANCH)"
