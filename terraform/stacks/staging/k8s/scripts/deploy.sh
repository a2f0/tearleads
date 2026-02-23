#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"
MANIFESTS_DIR="$STACK_DIR/manifests"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env
KUSTOMIZE_OVERLAY="$MANIFESTS_DIR/kustomize/overlays/staging"
USE_KUSTOMIZE="${USE_KUSTOMIZE:-false}"
STAGING_DOMAIN="${TF_VAR_staging_domain:-}"
K8S_HOSTNAME=""
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"

KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"

require_secret_env_vars() {
  local missing=()
  local required_vars=(
    "JWT_SECRET"
    "OPENROUTER_API_KEY"
    "POSTGRES_PASSWORD"
    "GARAGE_RPC_SECRET"
    "GARAGE_ADMIN_TOKEN"
    "VFS_BLOB_S3_ACCESS_KEY_ID"
    "VFS_BLOB_S3_SECRET_ACCESS_KEY"
  )

  local var_name
  for var_name in "${required_vars[@]}"; do
    if [[ -z "${!var_name:-}" ]]; then
      missing+=("$var_name")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required secret env vars for manifest rendering:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    echo "Set these in .secrets/env (or export in shell) and retry." >&2
    exit 1
  fi
}

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

if [[ -z "$STAGING_DOMAIN" ]]; then
  echo "ERROR: Could not determine staging domain."
  echo "Set TF_VAR_staging_domain or ensure terraform output k8s_hostname is available."
  exit 1
fi

if [[ -z "$LETSENCRYPT_EMAIL" ]]; then
  LETSENCRYPT_EMAIL="admin@$STAGING_DOMAIN"
fi
ESCAPED_LETSENCRYPT_EMAIL="$(printf '%s' "$LETSENCRYPT_EMAIL" | sed -e 's/[&|\\]/\\&/g')"
require_secret_env_vars

if ! command -v envsubst >/dev/null 2>&1; then
  echo "ERROR: envsubst is required to render secrets.yaml."
  echo "Install gettext (provides envsubst) and retry."
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
RENDERED_INGRESS="$TMP_DIR/ingress.yaml"
RENDERED_ISSUER="$TMP_DIR/cert-manager-issuer.yaml"
RENDERED_SECRETS="$TMP_DIR/secrets.yaml"
sed "s/DOMAIN_PLACEHOLDER/$STAGING_DOMAIN/g" "$MANIFESTS_DIR/ingress.yaml" > "$RENDERED_INGRESS"
sed "s|REPLACE_WITH_YOUR_EMAIL|$ESCAPED_LETSENCRYPT_EMAIL|g" "$MANIFESTS_DIR/cert-manager-issuer.yaml" > "$RENDERED_ISSUER"
envsubst < "$MANIFESTS_DIR/secrets.yaml" > "$RENDERED_SECRETS"

echo "Deploying manifests from $MANIFESTS_DIR..."

if [[ "$USE_KUSTOMIZE" == "true" ]]; then
  if [[ ! -d "$KUSTOMIZE_OVERLAY" ]]; then
    echo "ERROR: Kustomize overlay not found at $KUSTOMIZE_OVERLAY"
    exit 1
  fi

  echo "Applying secrets manifest directly (outside kustomize)."
  kubectl apply -f "$RENDERED_SECRETS"

  echo "Applying core resources via kustomize overlay: $KUSTOMIZE_OVERLAY"
  kubectl apply -k "$KUSTOMIZE_OVERLAY"
else
  # Apply manifests in order
  kubectl apply -f "$MANIFESTS_DIR/namespace.yaml"
  kubectl apply -f "$RENDERED_SECRETS"
  kubectl apply -f "$MANIFESTS_DIR/configmap.yaml"
  kubectl apply -f "$MANIFESTS_DIR/postgres.yaml"
  kubectl apply -f "$MANIFESTS_DIR/redis.yaml"
  kubectl apply -f "$MANIFESTS_DIR/garage.yaml"
  kubectl apply -f "$MANIFESTS_DIR/smtp-listener.yaml"
  kubectl apply -f "$MANIFESTS_DIR/api.yaml"
  kubectl apply -f "$MANIFESTS_DIR/client.yaml"
  kubectl apply -f "$MANIFESTS_DIR/website.yaml"
  kubectl apply -f "$MANIFESTS_DIR/cloudflared.yaml"
fi

# Ingress and issuer remain rendered templates.
kubectl apply -f "$RENDERED_INGRESS"
kubectl apply -f "$RENDERED_ISSUER"

echo ""
echo "Deployment complete!"
echo "Check status with: kubectl -n tearleads get pods"
