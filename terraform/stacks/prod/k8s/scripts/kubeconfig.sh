#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env

# Ensure Terraform backend/providers are initialized before reading outputs.
"$SCRIPT_DIR/init.sh"

# Get outputs from Terraform
SERVER_IP=$(terraform -chdir="$STACK_DIR" output -raw server_ip)
SERVER_USERNAME=$(terraform -chdir="$STACK_DIR" output -raw server_username)
if K8S_API_HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw k8s_api_hostname 2>/dev/null); then
  :
else
  K8S_API_HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw k8s_hostname)
fi

KUBECONFIG_FILE="${1:-$HOME/.kube/config-prod-k8s}"
SSH_RETRIES="${SSH_RETRIES:-30}"
SSH_RETRY_DELAY_SECONDS="${SSH_RETRY_DELAY_SECONDS:-10}"
SSH_CONNECT_TIMEOUT_SECONDS="${SSH_CONNECT_TIMEOUT_SECONDS:-10}"
K3S_KUBECONFIG_RETRIES="${K3S_KUBECONFIG_RETRIES:-30}"
K3S_KUBECONFIG_RETRY_DELAY_SECONDS="${K3S_KUBECONFIG_RETRY_DELAY_SECONDS:-10}"

echo "Fetching kubeconfig from $SERVER_USERNAME@$SERVER_IP..."

wait_for_ssh_ready "$SERVER_USERNAME@$SERVER_IP" "$SSH_RETRIES" "$SSH_RETRY_DELAY_SECONDS" "$SSH_CONNECT_TIMEOUT_SECONDS"

wait_for_k3s_kubeconfig() {
  local attempt=1
  while (( attempt <= K3S_KUBECONFIG_RETRIES )); do
    if ssh -o BatchMode=yes -o ConnectTimeout="$SSH_CONNECT_TIMEOUT_SECONDS" "$SERVER_USERNAME@$SERVER_IP" \
      'test -s /etc/rancher/k3s/k3s.yaml'; then
      return 0
    fi

    echo "k3s kubeconfig not ready yet (attempt $attempt/$K3S_KUBECONFIG_RETRIES). Retrying in ${K3S_KUBECONFIG_RETRY_DELAY_SECONDS}s..."
    sleep "$K3S_KUBECONFIG_RETRY_DELAY_SECONDS"
    ((attempt++))
  done

  echo "ERROR: /etc/rancher/k3s/k3s.yaml did not become available in time."
  return 1
}

wait_for_k3s_kubeconfig

tmp_kubeconfig="$(mktemp)"
trap 'rm -f "$tmp_kubeconfig"' EXIT

# Fetch kubeconfig and update server URL
ssh -o BatchMode=yes -o ConnectTimeout="$SSH_CONNECT_TIMEOUT_SECONDS" "$SERVER_USERNAME@$SERVER_IP" \
  'sudo cat /etc/rancher/k3s/k3s.yaml' | \
  sed "s/127.0.0.1/$K8S_API_HOSTNAME/" > "$tmp_kubeconfig"

if [[ ! -s "$tmp_kubeconfig" ]]; then
  echo "ERROR: Retrieved kubeconfig is empty."
  exit 1
fi

mv "$tmp_kubeconfig" "$KUBECONFIG_FILE"
trap - EXIT

chmod 600 "$KUBECONFIG_FILE"

echo "Kubeconfig saved to: $KUBECONFIG_FILE"
echo ""
echo "To use this cluster:"
echo "  export KUBECONFIG=$KUBECONFIG_FILE"
echo "  kubectl get nodes"
