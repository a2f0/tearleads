#!/usr/bin/env bash
# Storage owns its bucket and application credentials independently of servers.
set -euo pipefail

TIER="${1:-}"
ACTION="${2:-}"
case "$TIER:$ACTION" in
  staging:init | staging:plan | staging:apply | staging:output | staging:destroy | \
    prod:init | prod:plan | prod:apply | prod:output) ;;
  *)
    echo "Usage: $(basename "$0") <staging|prod> <init|plan|apply|output|destroy> [terraform arguments...]" >&2
    echo "Production storage cannot be destroyed through this wrapper." >&2
    exit 1
    ;;
esac
shift 2

REPO_ROOT="$(git rev-parse --show-toplevel)"
STACK_DIR="$REPO_ROOT/terraform/stacks/$TIER/storage"
# shellcheck source=terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env
validate_aws_env

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
