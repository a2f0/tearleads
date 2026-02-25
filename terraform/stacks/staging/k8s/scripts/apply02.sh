#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging

KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
K8S_READY_TIMEOUT="${K8S_READY_TIMEOUT:-300s}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
ECR_REPOSITORIES=(
  "tearleads-staging/api"
  "tearleads-staging/client"
  "tearleads-staging/smtp-listener"
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

  local all_repos=""
  if ! all_repos="$(aws ecr describe-repositories --region "$AWS_REGION" --query 'repositories[].repositoryName' --output text 2>/dev/null)"; then
    all_repos=""
  fi

  local all_repos_lines=""
  all_repos_lines="$(printf '%s\n' "$all_repos" | tr '\t' '\n')"

  local missing_repos=()
  local repo
  for repo in "${ECR_REPOSITORIES[@]}"; do
    if ! grep -Fxq "$repo" <<< "$all_repos_lines"; then
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

echo "Syncing kubeconfig to GitHub Actions secret..."
REPO="$(get_github_repo)"
if ! base64 < "$KUBECONFIG_FILE" | gh secret set STAGING_KUBECONFIG_B64 -R "$REPO"; then
  echo "ERROR: Failed to update STAGING_KUBECONFIG_B64 secret. Check gh CLI auth and permissions." >&2
  exit 1
fi
echo "STAGING_KUBECONFIG_B64 secret updated."

echo "Syncing k8s SSH hostname to GitHub Actions variable..."
K8S_SSH_HOST=$(terraform -chdir="$STACK_DIR" output -raw ssh_hostname)
gh variable set STAGING_K8S_SSH_HOST -R "$REPO" --body "$K8S_SSH_HOST"
echo "STAGING_K8S_SSH_HOST variable updated."

echo "Waiting for Kubernetes node readiness (timeout: $K8S_READY_TIMEOUT)..."
kubectl wait --for=condition=Ready nodes --all --timeout="$K8S_READY_TIMEOUT"

if ! command -v ansible-playbook >/dev/null 2>&1; then
  echo "ERROR: ansible-playbook is required for staging k8s baseline setup."
  echo "Install dependencies via ./ansible/scripts/setup.sh and re-run."
  exit 1
fi

echo "Running Ansible baseline bootstrap..."
TS_AUTH_KEY=$(terraform -chdir="$STACK_DIR" output -raw tailscale_auth_key 2>/dev/null || true)
if [[ -n "$TS_AUTH_KEY" && "$TS_AUTH_KEY" != "null" ]]; then
  "$REPO_ROOT/ansible/scripts/run-k8s.sh" --extra-vars "tailscale_auth_key=$TS_AUTH_KEY"
else
  "$REPO_ROOT/ansible/scripts/run-k8s.sh"
fi

check_ecr_repositories

echo "Ensuring namespace exists..."
kubectl apply -f "$STACK_DIR/manifests/namespace.yaml"

echo "Refreshing ECR pull secret..."
"$SCRIPT_DIR/setup-ecr-secret.sh"

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
