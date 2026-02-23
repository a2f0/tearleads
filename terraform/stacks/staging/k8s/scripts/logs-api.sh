#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
FOLLOW="${FOLLOW:-true}"
SINCE="${SINCE:-}"
TAIL_LINES="${TAIL_LINES:-100}"

if [[ ! -f "$KUBECONFIG_FILE" ]]; then
  echo "ERROR: Kubeconfig not found at $KUBECONFIG_FILE"
  echo "Run $SCRIPT_DIR/kubeconfig.sh first, then retry."
  exit 1
fi

export KUBECONFIG="$KUBECONFIG_FILE"

args=(-n "$NAMESPACE" -l app=api -c api)

if [[ "$FOLLOW" == "true" ]]; then
  args+=(-f)
fi

if [[ -n "$SINCE" ]]; then
  args+=(--since="$SINCE")
else
  args+=(--tail="$TAIL_LINES")
fi

kubectl logs "${args[@]}" "$@"
