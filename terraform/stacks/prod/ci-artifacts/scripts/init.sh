#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env

BACKEND_CONFIG=$(get_backend_config)

validate_aws_env
validate_production_domain_env

terraform -chdir="$STACK_DIR" init \
  -backend-config="$BACKEND_CONFIG" \
  "$@"
