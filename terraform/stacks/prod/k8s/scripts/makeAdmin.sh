#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-prod-k8s}"

if [[ ! -f "$KUBECONFIG_FILE" ]]; then
  echo "ERROR: Kubeconfig not found at $KUBECONFIG_FILE"
  echo "Run $SCRIPT_DIR/kubeconfig.sh first, then retry."
  exit 1
fi

export KUBECONFIG="$KUBECONFIG_FILE"

if [[ ${#} -eq 0 ]]; then
  kubectl -n "$NAMESPACE" exec deploy/api -c api -- node apiCli.cjs make-admin --help
  exit 0
fi

# Allow bare email argument without --email flag
if [[ "${1-}" != -* ]]; then
  set -- --email "$@"
fi

kubectl -n "$NAMESPACE" exec deploy/api -c api -- node apiCli.cjs make-admin "$@"
