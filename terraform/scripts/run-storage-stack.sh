#!/usr/bin/env bash
# Storage owns its bucket and application credentials independently of servers.
# Only the direct production destroy command is refused. Plan/apply remain
# available to trusted operators and the authorized saved-plan reset helpers.
# Those callers own confirmation, lifecycle overrides, and plan inspection;
# this wrapper is not a general production-deletion authorization boundary.
set -euo pipefail
# Wait for the foreground Terraform to finish, then stop even if it exits zero.
# Do not forward another interrupt: Terraform uses it to abort state recovery.
trap 'exit 130' INT

TIER="${1:-}"
ACTION="${2:-}"
case "$TIER:$ACTION" in
  staging:init | staging:plan | staging:apply | staging:output | staging:destroy | \
    prod:init | prod:plan | prod:apply | prod:output) ;;
  *)
    echo "Usage: $(basename "$0") <staging|prod> <init|plan|apply|output|destroy> [terraform arguments...]" >&2
    echo "Direct production destroy is disabled; use the authorized saved-plan workflow." >&2
    exit 1
    ;;
esac
shift 2

REPO_ROOT="$(git rev-parse --show-toplevel)"
STACK_DIR="$REPO_ROOT/terraform/stacks/$TIER/storage"
# shellcheck source=terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env "$TIER"
export_tf_state_env
validate_cloudflare_env

if [[ "$ACTION" == init ]]; then
  terraform -chdir="$STACK_DIR" init -input=false -reconfigure "$@"
else
  terraform -chdir="$STACK_DIR" init -input=false -reconfigure >&2
  case "$ACTION" in
    plan | apply) set -- -input=false "$@" ;;
  esac
  terraform -chdir="$STACK_DIR" "$ACTION" "$@"
fi
