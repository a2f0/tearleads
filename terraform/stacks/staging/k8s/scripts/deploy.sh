#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
MANIFESTS_DIR="$STACK_DIR/manifests"
STAGING_DOMAIN="${TF_VAR_staging_domain:-}"
K8S_HOSTNAME=""

KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"

if [[ ! -f "$KUBECONFIG" ]]; then
  echo "ERROR: Kubeconfig not found at $KUBECONFIG"
  echo "Run ./scripts/kubeconfig.sh first to fetch it"
  exit 1
fi

export KUBECONFIG

if [[ -z "$STAGING_DOMAIN" ]]; then
  K8S_HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw k8s_hostname 2>/dev/null || true)
  STAGING_DOMAIN="${K8S_HOSTNAME#k8s.}"
fi

if [[ "$STAGING_DOMAIN" == k8s.* ]]; then
  STAGING_DOMAIN="${STAGING_DOMAIN#k8s.}"
fi

if [[ -z "$STAGING_DOMAIN" ]]; then
  echo "ERROR: Could not determine staging domain."
  echo "Set TF_VAR_staging_domain or ensure terraform output k8s_hostname is available."
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
RENDERED_INGRESS="$TMP_DIR/ingress.yaml"
sed "s/DOMAIN_PLACEHOLDER/$STAGING_DOMAIN/g" "$MANIFESTS_DIR/ingress.yaml" > "$RENDERED_INGRESS"

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
kubectl apply -f "$RENDERED_INGRESS"
kubectl apply -f "$MANIFESTS_DIR/cert-manager-issuer.yaml"

echo ""
echo "Deployment complete!"
echo "Check status with: kubectl -n tearleads get pods"
