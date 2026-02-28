#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"
MANIFESTS_DIR="$STACK_DIR/manifests"
PRODUCTION_DOMAIN="${TF_VAR_domain:-}"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod

is_placeholder_value() {
  local value="$1"
  [[ "$value" =~ ^\$\{[A-Za-z_][A-Za-z0-9_]*\}$ ]]
}

resolve_s3_credentials_from_terraform() {
  local access_key="${VFS_BLOB_S3_ACCESS_KEY_ID:-}"
  local secret_key="${VFS_BLOB_S3_SECRET_ACCESS_KEY:-}"

  local need_access_key="false"
  local need_secret_key="false"

  if [[ -z "$access_key" ]] || is_placeholder_value "$access_key"; then
    need_access_key="true"
  fi

  if [[ -z "$secret_key" ]] || is_placeholder_value "$secret_key"; then
    need_secret_key="true"
  fi

  if [[ "$need_access_key" != "true" && "$need_secret_key" != "true" ]]; then
    return
  fi

  local s3_stack_dir="$REPO_ROOT/terraform/stacks/prod/s3"
  local s3_scripts_dir="$s3_stack_dir/scripts"

  echo "Resolving S3 IAM credentials from terraform outputs..."
  "$s3_scripts_dir/init.sh" >/dev/null

  if [[ "$need_access_key" == "true" ]]; then
    export VFS_BLOB_S3_ACCESS_KEY_ID
    VFS_BLOB_S3_ACCESS_KEY_ID="$(terraform -chdir="$s3_stack_dir" output -raw access_key_id)"
  fi

  if [[ "$need_secret_key" == "true" ]]; then
    export VFS_BLOB_S3_SECRET_ACCESS_KEY
    VFS_BLOB_S3_SECRET_ACCESS_KEY="$(terraform -chdir="$s3_stack_dir" output -raw secret_access_key)"
  fi
}

require_secret_env_vars() {
  local missing=()
  local required_vars=(
    "JWT_SECRET"
    "OPENROUTER_API_KEY"
    "POSTGRES_PASSWORD"
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
    echo "Set these in .secrets/prod.env (or export in shell) and retry." >&2
    exit 1
  fi
}

resolve_s3_credentials_from_terraform
require_secret_env_vars

if ! command -v envsubst >/dev/null 2>&1; then
  echo "ERROR: envsubst is required to render manifest templates." >&2
  echo "Install gettext (e.g., 'brew install gettext' or 'apt-get install gettext-base') and retry." >&2
  exit 1
fi

# Ensure Terraform backend/providers are initialized before reading outputs.
"$SCRIPT_DIR/init.sh"

# Read RDS endpoint from the prod/rds terraform stack
RDS_STACK_DIR="$REPO_ROOT/terraform/stacks/prod/rds"
export POSTGRES_HOST
POSTGRES_HOST="$(terraform -chdir="$RDS_STACK_DIR" output -raw address)"
echo "RDS endpoint: $POSTGRES_HOST"

# Read S3 bucket name from the prod/s3 terraform stack
S3_STACK_DIR="$REPO_ROOT/terraform/stacks/prod/s3"
export VFS_BLOB_S3_BUCKET
VFS_BLOB_S3_BUCKET="$(terraform -chdir="$S3_STACK_DIR" output -raw bucket_name)"
echo "S3 bucket: $VFS_BLOB_S3_BUCKET"

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
