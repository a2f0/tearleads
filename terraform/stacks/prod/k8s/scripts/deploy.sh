#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"
MANIFESTS_DIR="$STACK_DIR/manifests"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
PRODUCTION_DOMAIN="${TF_VAR_production_domain:-}"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env

# Ensure Terraform backend/providers are initialized before reading outputs.
"$SCRIPT_DIR/init.sh"

KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config-prod-k8s}"

if [[ ! -f "$KUBECONFIG" ]]; then
  echo "ERROR: Kubeconfig not found at $KUBECONFIG"
  echo "Run ./scripts/kubeconfig.sh first to fetch it"
  exit 1
fi

export KUBECONFIG

if [[ -z "$PRODUCTION_DOMAIN" ]]; then
  K8S_HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw k8s_hostname 2>/dev/null || true)
  PRODUCTION_DOMAIN="${K8S_HOSTNAME#k8s.}"
fi

if [[ -z "$LETSENCRYPT_EMAIL" ]]; then
  if [[ -n "$PRODUCTION_DOMAIN" ]]; then
    LETSENCRYPT_EMAIL="admin@$PRODUCTION_DOMAIN"
  else
    echo "ERROR: Could not determine production domain for default Let's Encrypt email."
    echo "Set LETSENCRYPT_EMAIL or TF_VAR_production_domain."
    exit 1
  fi
fi

ESCAPED_LETSENCRYPT_EMAIL="$(printf '%s' "$LETSENCRYPT_EMAIL" | sed -e 's/[&|\\]/\\&/g')"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
RENDERED_ISSUER="$TMP_DIR/cert-manager-issuer.yaml"
RENDERED_INGRESS="$TMP_DIR/ingress.yaml"
sed "s|__LETSENCRYPT_EMAIL__|$ESCAPED_LETSENCRYPT_EMAIL|g" \
  "$MANIFESTS_DIR/cert-manager-issuer.yaml" > "$RENDERED_ISSUER"
sed "s/DOMAIN_PLACEHOLDER/$PRODUCTION_DOMAIN/g" \
  "$MANIFESTS_DIR/ingress.yaml" > "$RENDERED_INGRESS"

echo "Deploying manifests to PRODUCTION from $MANIFESTS_DIR..."

# Apply manifests in order
kubectl apply -f "$MANIFESTS_DIR/namespace.yaml"
kubectl apply -f "$MANIFESTS_DIR/secrets.yaml"
kubectl apply -f "$MANIFESTS_DIR/configmap.yaml"
kubectl apply -f "$MANIFESTS_DIR/redis.yaml"
kubectl apply -f "$MANIFESTS_DIR/api.yaml"
kubectl apply -f "$MANIFESTS_DIR/client.yaml"
kubectl apply -f "$MANIFESTS_DIR/website.yaml"
kubectl apply -f "$RENDERED_INGRESS"
kubectl apply -f "$RENDERED_ISSUER"

echo ""
echo "Deployment complete!"
echo "Check status with: kubectl -n tearleads get pods"
