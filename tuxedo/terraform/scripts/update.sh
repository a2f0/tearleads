#!/bin/bash
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

BACKEND_CONFIG=$(get_backend_config)

validate_aws_env
validate_hetzner_env
validate_staging_domain_env
validate_cloudflare_env

terraform -chdir="$STACK_DIR" init \
  -backend-config="$BACKEND_CONFIG" \
  -upgrade \
  "$@"
