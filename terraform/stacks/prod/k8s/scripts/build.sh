#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

SKIP_WEBSITE="${SKIP_WEBSITE:-false}"

build_args=()
if [[ "$SKIP_WEBSITE" == "true" ]]; then
  build_args+=(--no-website)
fi

echo "Building and pushing production images..."
"$REPO_ROOT/scripts/buildContainers.sh" prod "${build_args[@]}" "$@"

echo ""
echo "Build complete. Images pushed to ECR."
