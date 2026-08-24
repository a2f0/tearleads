#!/usr/bin/env bash
# Run a server-stack Terraform action through one shared tier implementation.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $(basename "$0") <staging|prod> <init|apply|destroy> [terraform arguments...]" >&2
  exit 1
fi

TIER="$1"
ACTION="$2"
shift 2

case "$TIER" in
  staging | prod) ;;
  *)
    echo "ERROR: Unsupported server tier: $TIER" >&2
    exit 1
    ;;
esac

case "$ACTION" in
  init | apply | destroy) ;;
  *)
    echo "ERROR: Unsupported Terraform action: $ACTION" >&2
    exit 1
    ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel)"
STACK_DIR="$REPO_ROOT/terraform/stacks/$TIER/server"

# shellcheck source=./common.sh
# shellcheck disable=SC1091
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env "$TIER"
validate_aws_env
validate_hetzner_env
validate_cloudflare_env
validate_domain_env
validate_website_cache_env
validate_tailscale_env

if [[ "$ACTION" != destroy ]]; then
  validate_tailscale_auth_key_env
fi

if [[ "$ACTION" == destroy ]]; then
  echo "This will DESTROY the $TIER server and ALL its resources."
  echo "Waiting 5 seconds before proceeding..."
  sleep 5
fi

BACKEND_CONFIG="$(get_backend_config)"
if [[ "$ACTION" == init ]]; then
  terraform -chdir="$STACK_DIR" init \
    -reconfigure \
    -backend-config="$BACKEND_CONFIG" \
    "$@"
else
  terraform -chdir="$STACK_DIR" init \
    -reconfigure \
    -backend-config="$BACKEND_CONFIG"
  terraform -chdir="$STACK_DIR" "$ACTION" "$@"
fi
