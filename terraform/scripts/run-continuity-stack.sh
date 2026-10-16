#!/usr/bin/env bash
# The gallery is published by a separate repository, outside tier deployments.
set -euo pipefail
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <init|plan|apply|output> [terraform arguments...]" >&2
  exit 1
fi
ACTION="$1"
shift
case "$ACTION" in init | plan | apply | output) ;; *) echo "ERROR: Unsupported continuity action: $ACTION" >&2; exit 1 ;; esac
REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=./common.sh
# shellcheck disable=SC1091
source "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env prod
export_tf_state_env
validate_cloudflare_env
validate_domain_env
STACK_DIR="$REPO_ROOT/terraform/stacks/prod/continuity"
INIT_ARGS=()
if [[ "$ACTION" == init ]]; then INIT_ARGS=("$@"); fi
terraform -chdir="$STACK_DIR" init -input=false -reconfigure "${INIT_ARGS[@]+"${INIT_ARGS[@]}"}" >&2
if [[ "$ACTION" != init ]]; then
  INPUT_ARGS=()
  case "$ACTION" in plan | apply) INPUT_ARGS=(-input=false) ;; esac
  terraform -chdir="$STACK_DIR" "$ACTION" "${INPUT_ARGS[@]+"${INPUT_ARGS[@]}"}" "$@"
fi
