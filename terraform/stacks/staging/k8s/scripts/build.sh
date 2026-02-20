#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

SKIP_WEBSITE="${SKIP_WEBSITE:-false}"

echo "Building and pushing staging images..."
if [[ "$SKIP_WEBSITE" == "true" ]]; then
  "$REPO_ROOT/scripts/buildContainers.sh" staging --no-website "$@"
else
  "$REPO_ROOT/scripts/buildContainers.sh" staging "$@"
fi

echo ""
echo "Build complete. Images pushed to ECR."
