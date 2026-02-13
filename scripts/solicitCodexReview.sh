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
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")

if [ -z "$REPO" ]; then
  echo "Error: Could not determine repository. Ensure gh is authenticated." >&2
  exit 1
fi

PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number' -R "$REPO" 2>/dev/null || echo "")

if [ -z "$PR_NUMBER" ]; then
  echo "Error: No PR found for branch '$BRANCH'. Create a PR first." >&2
  exit 1
fi

# Resolve the actual PR base branch (supports roll-up PRs not targeting main)
BASE_REF=$(gh pr view "$PR_NUMBER" --json baseRefName -q .baseRefName -R "$REPO")

# Ensure there are changes against PR base
DIFF=$(git diff "$BASE_REF"...HEAD)

if [ -z "$DIFF" ]; then
  echo "Error: No changes found between $BASE_REF and current branch." >&2
  exit 1
fi

# Run Codex review in non-interactive mode (outputs to stdout)
# --base and [PROMPT] are mutually exclusive; use --base for the diff, --title for context
# NOTE: Do NOT override CODEX_HOME here - auth lives in ~/.codex/auth.json
codex review --base "$BASE_REF" --title "PR #$PR_NUMBER ($BRANCH)"
