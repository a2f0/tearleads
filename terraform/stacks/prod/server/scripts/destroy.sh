#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

echo "This will DESTROY the prod server and ALL its resources."
echo "Waiting 5 seconds before proceeding..."
sleep 5

source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod
validate_aws_env
validate_hetzner_env
validate_cloudflare_env
validate_domain_env
validate_tailscale_env

BACKEND_CONFIG="$(get_backend_config)"

terraform -chdir="$STACK_DIR" init \
  -reconfigure \
  -backend-config="$BACKEND_CONFIG"

terraform -chdir="$STACK_DIR" destroy "$@"
