#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"
MANIFESTS_DIR="$STACK_DIR/manifests"
PRODUCTION_DOMAIN="${TF_VAR_production_domain:-}"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env

require_secret_env_vars() {
  local missing=()
  local required_vars=(
    "JWT_SECRET"
    "POSTGRES_PASSWORD"
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

require_secret_env_vars

if ! command -v envsubst >/dev/null 2>&1; then
  echo "ERROR: envsubst is required to render secrets.yaml."
  echo "Install gettext (provides envsubst) and retry."
  exit 1
fi

# Ensure Terraform backend/providers are initialized before reading outputs.
"$SCRIPT_DIR/init.sh"

# Read RDS endpoint from the prod/rds terraform stack
RDS_STACK_DIR="$REPO_ROOT/terraform/stacks/prod/rds"
export POSTGRES_HOST
POSTGRES_HOST="$(terraform -chdir="$RDS_STACK_DIR" output -raw address)"
echo "RDS endpoint: $POSTGRES_HOST"

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

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
RENDERED_INGRESS="$TMP_DIR/ingress.yaml"
RENDERED_SECRETS="$TMP_DIR/secrets.yaml"
RENDERED_CONFIGMAP="$TMP_DIR/configmap.yaml"
sed "s/DOMAIN_PLACEHOLDER/$PRODUCTION_DOMAIN/g" \
  "$MANIFESTS_DIR/ingress.yaml" > "$RENDERED_INGRESS"
envsubst < "$MANIFESTS_DIR/secrets.yaml" > "$RENDERED_SECRETS"
envsubst < "$MANIFESTS_DIR/configmap.yaml" > "$RENDERED_CONFIGMAP"

echo "Deploying manifests to PRODUCTION from $MANIFESTS_DIR..."

# Apply manifests in order
kubectl apply -f "$MANIFESTS_DIR/namespace.yaml"
kubectl apply -f "$RENDERED_SECRETS"
kubectl apply -f "$RENDERED_CONFIGMAP"
kubectl apply -f "$MANIFESTS_DIR/redis.yaml"
kubectl apply -f "$MANIFESTS_DIR/api.yaml"
kubectl apply -f "$MANIFESTS_DIR/client.yaml"
kubectl apply -f "$MANIFESTS_DIR/website.yaml"
kubectl apply -f "$MANIFESTS_DIR/cloudflared.yaml"
kubectl apply -f "$RENDERED_INGRESS"

echo ""
echo "Deployment complete!"
echo "Check status with: kubectl -n tearleads get pods"
