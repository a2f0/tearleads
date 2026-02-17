#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
K8S_READY_TIMEOUT="${K8S_READY_TIMEOUT:-300s}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
CERT_MANAGER_MANIFEST_URL="${CERT_MANAGER_MANIFEST_URL:-https://github.com/cert-manager/cert-manager/releases/download/v1.14.5/cert-manager.yaml}"
INGRESS_NGINX_MANIFEST_URL="${INGRESS_NGINX_MANIFEST_URL:-https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/cloud/deploy.yaml}"
ECR_REPOSITORIES=(
  "tearleads-staging/api"
  "tearleads-staging/client"
  "tearleads-staging/website"
)

require_aws_cli_and_credentials() {
  if ! command -v aws >/dev/null 2>&1; then
    echo "ERROR: aws CLI is required for ECR preflight checks."
    exit 1
  fi

  if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
    echo "ERROR: AWS credentials are required for ECR preflight checks."
    echo "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, then re-run."
    exit 1
  fi
}

check_ecr_repositories() {
  require_aws_cli_and_credentials

  if [[ -z "$AWS_ACCOUNT_ID" ]]; then
    AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
  fi

  echo "Checking required ECR repositories in account $AWS_ACCOUNT_ID (region: $AWS_REGION)..."

  local missing_repos=()
  local repo
  for repo in "${ECR_REPOSITORIES[@]}"; do
    if ! aws ecr describe-repositories --region "$AWS_REGION" --repository-names "$repo" >/dev/null 2>&1; then
      missing_repos+=("$repo")
    fi
  done

  if [[ ${#missing_repos[@]} -gt 0 ]]; then
    echo "ERROR: Missing ECR repositories:"
    printf '  - %s\n' "${missing_repos[@]}"
    echo "Deploy staging ci-artifacts first: ../../ci-artifacts/scripts/apply.sh"
    exit 1
  fi
}

ensure_cert_manager_installed() {
  if kubectl get crd clusterissuers.cert-manager.io >/dev/null 2>&1; then
    echo "cert-manager CRDs already present."
    return
  fi

  echo "Installing cert-manager from $CERT_MANAGER_MANIFEST_URL..."
  kubectl apply -f "$CERT_MANAGER_MANIFEST_URL"

  echo "Waiting for cert-manager deployments to become ready..."
  kubectl rollout status deployment/cert-manager -n cert-manager --timeout=300s
  kubectl rollout status deployment/cert-manager-cainjector -n cert-manager --timeout=300s
  kubectl rollout status deployment/cert-manager-webhook -n cert-manager --timeout=300s
}

ensure_ingress_nginx_installed() {
  if kubectl get deployment ingress-nginx-controller -n ingress-nginx >/dev/null 2>&1; then
    echo "ingress-nginx already installed."
  else
    echo "Installing ingress-nginx from $INGRESS_NGINX_MANIFEST_URL..."
    kubectl apply -f "$INGRESS_NGINX_MANIFEST_URL"
  fi

  echo "Waiting for ingress-nginx controller to become ready..."
  kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx --timeout=300s

  # Required for cert-manager HTTP-01 solver ingress paths using pathType=Exact.
  kubectl patch configmap ingress-nginx-controller -n ingress-nginx \
    --type merge \
    -p '{"data":{"strict-validate-path-type":"false"}}'
}

ensure_cloudflare_tunnel_secret() {
  local tunnel_token=""

  if tunnel_token=$(terraform -chdir="$STACK_DIR" output -raw tunnel_token 2>/dev/null); then
    :
  else
    echo "Cloudflare tunnel output not available; skipping cloudflared secret setup."
    return
  fi

  if [[ -z "$tunnel_token" || "$tunnel_token" == "null" ]]; then
    echo "Cloudflare tunnel token is empty; skipping cloudflared secret setup."
    return
  fi

  echo "Applying cloudflared tunnel token secret..."
  kubectl -n tearleads create secret generic cloudflared-tunnel-token \
    --from-literal=TUNNEL_TOKEN="$tunnel_token" \
    --dry-run=client \
    -o yaml | kubectl apply -f -
}

"$SCRIPT_DIR/kubeconfig.sh" "$KUBECONFIG_FILE"
export KUBECONFIG="$KUBECONFIG_FILE"

echo "Waiting for Kubernetes node readiness (timeout: $K8S_READY_TIMEOUT)..."
kubectl wait --for=condition=Ready nodes --all --timeout="$K8S_READY_TIMEOUT"

check_ecr_repositories

echo "Ensuring namespace exists..."
kubectl apply -f "$STACK_DIR/manifests/namespace.yaml"

echo "Refreshing ECR pull secret..."
"$SCRIPT_DIR/setup-ecr-secret.sh"

ensure_cert_manager_installed
ensure_ingress_nginx_installed
ensure_cloudflare_tunnel_secret

echo "Deploying Kubernetes manifests..."
"$SCRIPT_DIR/deploy.sh"

if kubectl get deployment cloudflared -n tearleads >/dev/null 2>&1; then
  echo "Waiting for cloudflared rollout..."
  kubectl rollout status deployment/cloudflared -n tearleads --timeout=300s
fi

echo ""
echo "Step 2 complete. Cluster bootstrap and manifests are applied."
echo "Terraform stack: $STACK_DIR"
