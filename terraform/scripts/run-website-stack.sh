#!/usr/bin/env bash
# Website domains have independent state and never depend on server outputs.
set -euo pipefail
if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <staging|prod> <init|plan|apply|destroy|output> [terraform arguments...]" >&2
  exit 1
fi
TIER="$1"
ACTION="$2"
shift 2
case "$TIER" in staging | prod) ;; *) echo "ERROR: Unsupported website tier: $TIER" >&2; exit 1 ;; esac
case "$ACTION" in init | plan | apply | destroy | output) ;; *) echo "ERROR: Unsupported website action: $ACTION" >&2; exit 1 ;; esac
if [[ "$TIER:$ACTION" == prod:destroy ]]; then
  echo "ERROR: Production website domains cannot be destroyed through this wrapper." >&2
  exit 1
fi
REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=./common.sh
# shellcheck disable=SC1091
source "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env "$TIER"
validate_aws_env
validate_cloudflare_env
validate_domain_env
STACK_DIR="$REPO_ROOT/terraform/stacks/$TIER/website"
INIT_ARGS=()
if [[ "$ACTION" == init ]]; then INIT_ARGS=("$@"); fi
terraform -chdir="$STACK_DIR" init -input=false -reconfigure \
  -backend-config="$(get_backend_config)" "${INIT_ARGS[@]+"${INIT_ARGS[@]}"}" >&2
if [[ "$ACTION" != init ]]; then
  INPUT_ARGS=()
  case "$ACTION" in plan | apply) INPUT_ARGS=(-input=false) ;; esac
  terraform -chdir="$STACK_DIR" "$ACTION" "${INPUT_ARGS[@]+"${INPUT_ARGS[@]}"}" "$@"
fi
