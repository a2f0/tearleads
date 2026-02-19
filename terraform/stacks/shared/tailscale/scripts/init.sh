#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

BACKEND_CONFIG="$(get_backend_config)"

validate_aws_env

if [[ -z "${TF_VAR_tailscale_tailnet_id:-}" ]]; then
  echo "ERROR: TF_VAR_tailscale_tailnet_id is required" >&2
  exit 1
fi

if [[ -z "${TF_VAR_tailscale_api_token:-}" ]]; then
  echo "ERROR: TF_VAR_tailscale_api_token is required" >&2
  exit 1
fi

terraform -chdir="$STACK_DIR" init \
  -backend-config="$BACKEND_CONFIG" \
  "$@"
