#!/usr/bin/env bash
# Manage a tier's independent PlanetScale Postgres stack. Production cannot be
# destroyed through this wrapper; staging is disposable.
set -euo pipefail

TIER="${1:-}"
ACTION="${2:-}"
case "$TIER:$ACTION" in
  staging:init | staging:plan | staging:apply | staging:output | staging:destroy | \
    prod:init | prod:plan | prod:apply | prod:output) ;;
  *)
    echo "Usage: $(basename "$0") <staging|prod> <init|plan|apply|output|destroy> [terraform arguments...]" >&2
    echo "Production Postgres cannot be destroyed through this wrapper." >&2
    exit 1
    ;;
esac
shift 2

REPO_ROOT="$(git rev-parse --show-toplevel)"
STACK_DIR="$REPO_ROOT/terraform/stacks/$TIER/postgres"

# shellcheck source=terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

# Backend credentials come from the tier's shared.env; PlanetScale has its own
# secret file in the same tier folder.
load_secrets_env "$TIER"
_source_optional_env_file "$REPO_ROOT/.secrets/$TIER/planetscale.env"
validate_aws_env
export TF_VAR_planetscale_service_token_id="${PLANETSCALE_SERVICE_TOKEN_ID:-}"
export TF_VAR_planetscale_service_token="${PLANETSCALE_SERVICE_TOKEN:-}"

case "$ACTION" in
  plan | apply | destroy)
    validate_cloudflare_env
    if [[ "${PLANETSCALE_SERVICE_TOKEN_ID:+set}" != set || "${PLANETSCALE_SERVICE_TOKEN:+set}" != set ]]; then
      echo "ERROR: Set PLANETSCALE_SERVICE_TOKEN_ID and PLANETSCALE_SERVICE_TOKEN in .secrets/$TIER/planetscale.env or the environment." >&2
      exit 1
    fi
    ;;
esac

if [[ "$ACTION" == init ]]; then
  terraform -chdir="$STACK_DIR" init -input=false -reconfigure \
    -backend-config="$(get_backend_config)" "$@"
else
  terraform -chdir="$STACK_DIR" init -input=false -reconfigure \
    -backend-config="$(get_backend_config)" >&2
  case "$ACTION" in
    plan | apply | destroy) set -- -input=false "$@" ;;
  esac
  terraform -chdir="$STACK_DIR" "$ACTION" "$@"
fi
