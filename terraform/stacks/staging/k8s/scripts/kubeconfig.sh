#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env

# Get outputs from Terraform
SERVER_IP=$(terraform -chdir="$STACK_DIR" output -raw server_ip)
if K8S_API_HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw k8s_api_hostname 2>/dev/null); then
  :
else
  K8S_API_HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw k8s_hostname)
fi

if SERVER_USERNAME=$(terraform -chdir="$STACK_DIR" output -raw server_username 2>/dev/null); then
  :
elif SERVER_USERNAME=$(terraform -chdir="$STACK_DIR" output -raw SERVER_USERNAME 2>/dev/null); then
  :
else
  SSH_COMMAND=$(terraform -chdir="$STACK_DIR" output -raw ssh_command 2>/dev/null || true)
  SERVER_USERNAME="${SSH_COMMAND#ssh }"
  SERVER_USERNAME="${SERVER_USERNAME%@*}"
fi

if [[ -z "$SERVER_USERNAME" ]]; then
  echo "ERROR: Could not determine server username from Terraform outputs."
  echo "Expected one of: server_username, SERVER_USERNAME, or ssh_command."
  exit 1
fi

KUBECONFIG_FILE="${1:-$HOME/.kube/config-staging-k8s}"
SSH_RETRIES="${SSH_RETRIES:-30}"
SSH_RETRY_DELAY_SECONDS="${SSH_RETRY_DELAY_SECONDS:-10}"
SSH_CONNECT_TIMEOUT_SECONDS="${SSH_CONNECT_TIMEOUT_SECONDS:-10}"

echo "Fetching kubeconfig from $SERVER_USERNAME@$SERVER_IP..."

wait_for_ssh_ready "$SERVER_USERNAME@$SERVER_IP" "$SSH_RETRIES" "$SSH_RETRY_DELAY_SECONDS" "$SSH_CONNECT_TIMEOUT_SECONDS"

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
