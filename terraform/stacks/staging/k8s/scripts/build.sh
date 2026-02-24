#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging

SKIP_WEBSITE="${SKIP_WEBSITE:-false}"

build_args=()
if [[ "$SKIP_WEBSITE" == "true" ]]; then
  build_args+=(--no-website)
fi

echo "Building and pushing staging images..."
cmd=("$REPO_ROOT/scripts/buildContainers.sh" staging)
if ((${#build_args[@]})); then
  cmd+=("${build_args[@]}")
fi
cmd+=("$@")
"${cmd[@]}"

echo ""
echo "Build complete. Images pushed to ECR."
