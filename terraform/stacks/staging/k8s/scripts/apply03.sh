#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-300s}"

if [[ ! -f "$KUBECONFIG_FILE" ]]; then
  echo "ERROR: Kubeconfig not found at $KUBECONFIG_FILE"
  echo "Run $SCRIPT_DIR/apply02.sh first (or set KUBECONFIG)."
  exit 1
fi

export KUBECONFIG="$KUBECONFIG_FILE"

echo "Building and pushing staging images..."
"$REPO_ROOT/scripts/buildContainers.sh" staging "$@"

echo "Refreshing ECR pull secret..."
"$SCRIPT_DIR/setup-ecr-secret.sh"

echo "Restarting deployments..."
kubectl rollout restart deployment/api deployment/client deployment/website -n tearleads

echo "Waiting for rollouts (timeout: $ROLLOUT_TIMEOUT)..."
kubectl rollout status deployment/api -n tearleads --timeout="$ROLLOUT_TIMEOUT"
kubectl rollout status deployment/client -n tearleads --timeout="$ROLLOUT_TIMEOUT"
kubectl rollout status deployment/website -n tearleads --timeout="$ROLLOUT_TIMEOUT"

echo ""
echo "Step 3 complete. Latest staging images are deployed."
echo "Terraform stack: $STACK_DIR"
