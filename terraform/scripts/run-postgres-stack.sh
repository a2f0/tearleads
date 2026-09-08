#!/usr/bin/env bash
# Manage the independent production PlanetScale stack.
set -euo pipefail

ACTION="${1:-}"
case "$ACTION" in
  init | plan | apply | output) shift ;;
  *)
    echo "Usage: $(basename "$0") <init|plan|apply|output> [terraform arguments...]" >&2
    exit 1
    ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel)"
STACK_DIR="$REPO_ROOT/terraform/stacks/prod/postgres"

# shellcheck source=terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

# Backend credentials come from root.env; PlanetScale has its own secret file.
load_secrets_env
_source_optional_env_file "$REPO_ROOT/.secrets/planetscale.env"
validate_aws_env

if [[ "$ACTION" == plan || "$ACTION" == apply ]]; then
  if [[ "${PLANETSCALE_SERVICE_TOKEN_ID:+set}" != set || "${PLANETSCALE_SERVICE_TOKEN:+set}" != set ]]; then
    echo "ERROR: Set PLANETSCALE_SERVICE_TOKEN_ID and PLANETSCALE_SERVICE_TOKEN in .secrets/planetscale.env or the environment." >&2
    exit 1
  fi
fi

if [[ "$ACTION" == init ]]; then
  terraform -chdir="$STACK_DIR" init -input=false -reconfigure \
    -backend-config="$(get_backend_config)" "$@"
else
  terraform -chdir="$STACK_DIR" init -input=false -reconfigure \
    -backend-config="$(get_backend_config)" >&2
  if [[ "$ACTION" == plan || "$ACTION" == apply ]]; then
    set -- -input=false "$@"
  fi
  terraform -chdir="$STACK_DIR" "$ACTION" "$@"
fi
