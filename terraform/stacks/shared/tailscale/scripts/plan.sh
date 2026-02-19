#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

if [[ -z "${TF_VAR_tailscale_tailnet_id:-}" ]]; then
  echo "ERROR: TF_VAR_tailscale_tailnet_id is required" >&2
  exit 1
fi

if [[ -z "${TF_VAR_tailscale_api_token:-}" ]]; then
  echo "ERROR: TF_VAR_tailscale_api_token is required" >&2
  exit 1
fi

terraform -chdir="$STACK_DIR" plan "$@"
