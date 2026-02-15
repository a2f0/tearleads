#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
MANIFESTS_DIR="$STACK_DIR/manifests"

KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"

if [[ ! -f "$KUBECONFIG" ]]; then
  echo "ERROR: Kubeconfig not found at $KUBECONFIG"
  echo "Run ./scripts/kubeconfig.sh first to fetch it"
  exit 1
fi

export KUBECONFIG

echo "Deploying manifests from $MANIFESTS_DIR..."

# Apply manifests in order
kubectl apply -f "$MANIFESTS_DIR/namespace.yaml"
kubectl apply -f "$MANIFESTS_DIR/secrets.yaml"
kubectl apply -f "$MANIFESTS_DIR/configmap.yaml"
kubectl apply -f "$MANIFESTS_DIR/postgres.yaml"
kubectl apply -f "$MANIFESTS_DIR/redis.yaml"
kubectl apply -f "$MANIFESTS_DIR/api.yaml"
kubectl apply -f "$MANIFESTS_DIR/client.yaml"
kubectl apply -f "$MANIFESTS_DIR/website.yaml"
kubectl apply -f "$MANIFESTS_DIR/ingress.yaml"
kubectl apply -f "$MANIFESTS_DIR/cert-manager-issuer.yaml"

echo ""
echo "Deployment complete!"
echo "Check status with: kubectl -n tearleads get pods"
