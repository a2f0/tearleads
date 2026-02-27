#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod
load_vault_token

BACKEND_CONFIG=$(get_backend_config)

validate_aws_env
validate_hetzner_env

# Validate Tailscale API token for device cleanup on destroy
if [[ -z "${TF_VAR_tailscale_api_token:-}" ]]; then
  echo "ERROR: Missing TF_VAR_tailscale_api_token (required for Tailscale device cleanup)" >&2
  exit 1
fi

terraform -chdir="$STACK_DIR" init \
  -backend-config="$BACKEND_CONFIG" \
  "$@"
