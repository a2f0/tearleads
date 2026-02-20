#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

SKIP_WEBSITE="${SKIP_WEBSITE:-false}"

echo "Building and pushing production images..."
if [[ "$SKIP_WEBSITE" == "true" ]]; then
  "$REPO_ROOT/scripts/buildContainers.sh" prod --no-website "$@"
else
  "$REPO_ROOT/scripts/buildContainers.sh" prod "$@"
fi

echo ""
echo "Build complete. Images pushed to ECR."
