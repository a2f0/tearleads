#!/bin/bash
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging

SKIP_INIT="${SKIP_INIT:-false}"
APPLY_ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--skip-init" ]]; then
    SKIP_INIT=true
  else
    APPLY_ARGS+=("$arg")
  fi
done

if [[ "$SKIP_INIT" != "true" ]]; then
  terraform -chdir="$STACK_DIR" init -backend-config="$(get_backend_config)"
fi
terraform -chdir="$STACK_DIR" apply "${APPLY_ARGS[@]}"
