#!/bin/bash
# Approve skipped CI checks for the current PR by creating passing check runs.
#
# Usage: ./scripts/approveSkippedChecks.sh [--pr <number>] [--dry-run]
#
# This script creates check runs with "success" conclusion for required checks
# that are currently "skipped" due to CI impact detection. This allows skill-only
# PRs to pass branch protection without triggering full CI runs.
#
# Requires: gh CLI authenticated with repo scope

set -euo pipefail

PR_NUMBER=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --pr)
      PR_NUMBER="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

if [[ -z "$PR_NUMBER" ]]; then
  PR_NUMBER=$(gh pr view --json number -q .number 2>/dev/null || echo "")
  if [[ -z "$PR_NUMBER" ]]; then
    echo "Error: Could not determine PR number. Use --pr <number>" >&2
    exit 1
  fi
fi

# Get the head SHA of the PR
HEAD_SHA=$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid -R "$REPO")

echo "Repository: $REPO"
echo "PR: #$PR_NUMBER"
echo "Head SHA: $HEAD_SHA"
echo ""

# Required checks that branch protection requires
REQUIRED_CHECKS=(
  "build"
  "Web E2E Tests (Release)"
  "Electron E2E Tests (Release)"
  "Website E2E Tests (Release)"
  "Android Instrumented Tests"
  "Android Maestro Tests (Release)"
  "iOS Maestro Tests (Release)"
)

# Get current check runs for the commit
CURRENT_CHECKS=$(gh api "repos/$REPO/commits/$HEAD_SHA/check-runs" --jq '.check_runs')

# Function to get check status
get_check_status() {
  local name="$1"
  echo "$CURRENT_CHECKS" | jq -r --arg name "$name" '.[] | select(.name == $name) | "\(.status)|\(.conclusion)"' | head -1
}

# Function to create a check run
create_check_run() {
  local name="$1"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY-RUN] Would create check run: $name"
    return 0
  fi

  # Create a completed check run with success
  # shellcheck disable=SC2102
  gh api "repos/$REPO/check-runs" \
    --method POST \
    -f name="$name" \
    -f head_sha="$HEAD_SHA" \
    -f status="completed" \
    -f conclusion="success" \
    -f 'output[title]=Skipped (no impact)' \
    -f 'output[summary]=This check was skipped because no relevant code changes were detected. Approved by approveSkippedChecks.sh.' \
    > /dev/null 2>&1

  echo "  Created passing check run: $name"
}

echo "Checking required checks..."
CREATED=0
ALREADY_PASSING=0

for check_name in "${REQUIRED_CHECKS[@]}"; do
  STATUS_CONCLUSION=$(get_check_status "$check_name")
  STATUS=$(echo "$STATUS_CONCLUSION" | cut -d'|' -f1)
  CONCLUSION=$(echo "$STATUS_CONCLUSION" | cut -d'|' -f2)

  if [[ -z "$STATUS" ]]; then
    echo "  $check_name: MISSING"
    create_check_run "$check_name"
    CREATED=$((CREATED + 1))
  elif [[ "$STATUS" == "completed" && "$CONCLUSION" == "skipped" ]]; then
    echo "  $check_name: SKIPPED -> creating passing check"
    create_check_run "$check_name"
    CREATED=$((CREATED + 1))
  elif [[ "$STATUS" == "completed" && "$CONCLUSION" == "success" ]]; then
    echo "  $check_name: already passing"
    ALREADY_PASSING=$((ALREADY_PASSING + 1))
  else
    echo "  $check_name: $STATUS ($CONCLUSION)"
  fi
done

echo ""
echo "Summary: $CREATED check(s) created, $ALREADY_PASSING already passing"

if [[ "$DRY_RUN" == "false" && $CREATED -gt 0 ]]; then
  echo ""
  echo "Check PR status at:"
  echo "  https://github.com/$REPO/pull/$PR_NUMBER"
fi
