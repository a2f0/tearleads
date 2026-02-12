#!/bin/bash
# Trigger CI workflows for the current branch and create passing check runs
# for required checks that would otherwise be skipped.
#
# Usage: ./scripts/triggerCiBuild.sh [--branch <branch>] [--wait]
#
# This script is useful for skill-only PRs where the CI impact detection
# skips all jobs, causing branch protection to block the merge.

set -euo pipefail

BRANCH=""
WAIT=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --wait)
      WAIT=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$BRANCH" ]]; then
  BRANCH=$(git branch --show-current)
fi

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
HEAD_SHA=$(git rev-parse HEAD)

echo "Triggering CI workflows for branch: $BRANCH (commit: ${HEAD_SHA:0:8})"
echo "Repository: $REPO"

# Required workflow files and their corresponding check names
declare -A WORKFLOWS=(
  ["build.yml"]="build"
  ["web-e2e.yml"]="Web E2E Tests (Release)"
  ["electron-e2e.yml"]="Electron E2E Tests (Release)"
  ["website-e2e.yml"]="Website E2E Tests (Release)"
  ["android.yml"]="Android Instrumented Tests"
  ["android-maestro-release.yml"]="Android Maestro Tests (Release)"
  ["ios-maestro-release.yml"]="iOS Maestro Tests (Release)"
)

# Trigger all workflows
echo ""
echo "Triggering workflows..."
for workflow in "${!WORKFLOWS[@]}"; do
  echo "  - $workflow"
  gh workflow run "$workflow" --ref "$BRANCH" -R "$REPO" 2>/dev/null || true
done

if [[ "$WAIT" == "true" ]]; then
  echo ""
  echo "Waiting for workflows to complete..."

  # Wait for workflows to start
  sleep 30

  MAX_WAIT=3600  # 1 hour max
  POLL_INTERVAL=30
  ELAPSED=0

  while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    # Get status of all workflow runs for this commit
    RUNS=$(gh run list --commit "$HEAD_SHA" --json name,status,conclusion -R "$REPO")

    PENDING=0
    FAILED=0

    for workflow in "${!WORKFLOWS[@]}"; do
      CHECK_NAME="${WORKFLOWS[$workflow]}"
      STATUS=$(echo "$RUNS" | jq -r --arg name "$CHECK_NAME" '.[] | select(.name == $name) | .status' | head -1)
      CONCLUSION=$(echo "$RUNS" | jq -r --arg name "$CHECK_NAME" '.[] | select(.name == $name) | .conclusion' | head -1)

      if [[ "$STATUS" == "completed" ]]; then
        if [[ "$CONCLUSION" != "success" && "$CONCLUSION" != "skipped" ]]; then
          echo "  FAILED: $CHECK_NAME ($CONCLUSION)"
          FAILED=$((FAILED + 1))
        fi
      elif [[ -n "$STATUS" ]]; then
        PENDING=$((PENDING + 1))
      fi
    done

    if [[ $FAILED -gt 0 ]]; then
      echo "Some workflows failed."
      exit 1
    fi

    if [[ $PENDING -eq 0 ]]; then
      echo "All workflows completed."
      break
    fi

    echo "  $PENDING workflow(s) still running... (${ELAPSED}s elapsed)"
    sleep $POLL_INTERVAL
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
  done

  if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    echo "Timeout waiting for workflows."
    exit 1
  fi
fi

echo ""
echo "Done. Check PR status at:"
echo "  https://github.com/$REPO/pull/$(gh pr view --json number -q .number -R "$REPO" 2>/dev/null || echo '<pr-number>')"
