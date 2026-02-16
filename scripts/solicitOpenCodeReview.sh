#!/bin/sh
set -eu

# Solicit a code review from OpenCode for the current PR/branch
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
if git diff --quiet "$BASE_REF"...HEAD; then
  echo "Error: No changes found between $BASE_REF and current branch." >&2
  exit 1
fi

# Stream prompt to stdin to avoid ARG_MAX limits
{
    printf "Review this PR diff. Be concise and actionable.\n\n"
    printf "## Review Guidelines\n"
    if [ -f "$ROOT_DIR/REVIEW.md" ]; then
        cat "$ROOT_DIR/REVIEW.md"
    fi
    printf "\n\n## PR Context\n"
    printf "Branch: %s\n" "$BRANCH"
    printf "PR: #%s\n" "$PR_NUMBER"
    printf "Base: %s\n" "$BASE_REF"
    printf "\n\n## Diff\n"
    git diff "$BASE_REF"...HEAD
    printf "\n\n## Instructions\n"
    printf -- "- Flag security issues, type safety violations, and missing tests as high priority\n"
    printf -- "- Use severity levels: Blocker, Major, Minor, Suggestion\n"
    printf -- "- Be concise: one line per issue with file:line reference\n"
    printf -- "- Output your review to stdout\n"
} | exec opencode run
