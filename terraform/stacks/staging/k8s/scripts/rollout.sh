#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-300s}"
SKIP_WEBSITE="${SKIP_WEBSITE:-false}"

if [[ ! -f "$KUBECONFIG_FILE" ]]; then
  echo "ERROR: Kubeconfig not found at $KUBECONFIG_FILE"
  echo "Run $SCRIPT_DIR/apply02.sh first (or set KUBECONFIG)."
  exit 1
fi

export KUBECONFIG="$KUBECONFIG_FILE"

echo "Refreshing ECR pull secret..."
"$SCRIPT_DIR/setup-ecr-secret.sh"

echo "Restarting deployments..."
kubectl rollout restart deployment/api deployment/client -n tearleads
if [[ "$SKIP_WEBSITE" != "true" ]]; then
  kubectl rollout restart deployment/website -n tearleads
fi

echo "Waiting for rollouts (timeout: $ROLLOUT_TIMEOUT)..."
kubectl rollout status deployment/api -n tearleads --timeout="$ROLLOUT_TIMEOUT"
kubectl rollout status deployment/client -n tearleads --timeout="$ROLLOUT_TIMEOUT"
if [[ "$SKIP_WEBSITE" != "true" ]]; then
  kubectl rollout status deployment/website -n tearleads --timeout="$ROLLOUT_TIMEOUT"
fi

echo ""
echo "Rollout complete. Deployments are running latest images."
