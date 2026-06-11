#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod
validate_aws_env
validate_hetzner_env
validate_cloudflare_env
validate_domain_env
validate_tailscale_auth_key_env

BACKEND_CONFIG="$(get_backend_config)"

terraform -chdir="$STACK_DIR" init \
  -reconfigure \
  -backend-config="$BACKEND_CONFIG" \
  "$@"
