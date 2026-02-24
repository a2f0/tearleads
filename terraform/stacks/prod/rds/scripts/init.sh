#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod

# Bridge POSTGRES_PASSWORD → TF_VAR_postgres_password so .secrets/env
# uses the same variable name as the k8s stack.
export TF_VAR_postgres_password="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .secrets/env}"

validate_aws_env

BACKEND_CONFIG=$(get_backend_config)

terraform -chdir="$STACK_DIR" init \
  -backend-config="$BACKEND_CONFIG" \
  "$@"
