#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

# shellcheck source=./auth.sh
source "$SCRIPT_DIR/auth.sh"

load_secrets_env

hydrate_googleworkspace_auth "$REPO_ROOT"

terraform -chdir="$STACK_DIR" init -backend-config="$(get_backend_config)"
terraform -chdir="$STACK_DIR" apply "$@"
