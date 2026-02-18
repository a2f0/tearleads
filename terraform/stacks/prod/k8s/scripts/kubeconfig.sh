#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

# Get outputs from Terraform
SERVER_IP=$(terraform -chdir="$STACK_DIR" output -raw server_ip)
SERVER_USERNAME=$(terraform -chdir="$STACK_DIR" output -raw server_username)
K8S_HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw k8s_hostname)

KUBECONFIG_FILE="${1:-$HOME/.kube/config-prod-k8s}"
SSH_RETRIES="${SSH_RETRIES:-30}"
SSH_RETRY_DELAY_SECONDS="${SSH_RETRY_DELAY_SECONDS:-10}"
SSH_CONNECT_TIMEOUT_SECONDS="${SSH_CONNECT_TIMEOUT_SECONDS:-10}"

echo "Fetching kubeconfig from $SERVER_USERNAME@$SERVER_IP..."

attempt=1
while (( attempt <= SSH_RETRIES )); do
  if ssh -o BatchMode=yes -o ConnectTimeout="$SSH_CONNECT_TIMEOUT_SECONDS" "$SERVER_USERNAME@$SERVER_IP" true >/dev/null 2>&1; then
    break
  fi

  echo "SSH not ready yet (attempt $attempt/$SSH_RETRIES). Retrying in ${SSH_RETRY_DELAY_SECONDS}s..."
  sleep "$SSH_RETRY_DELAY_SECONDS"
  ((attempt++))
done

if (( attempt > SSH_RETRIES )); then
  echo "ERROR: Unable to connect to $SERVER_USERNAME@$SERVER_IP over SSH after $SSH_RETRIES attempts."
  exit 1
fi

tmp_kubeconfig="$(mktemp)"
trap 'rm -f "$tmp_kubeconfig"' EXIT

# Fetch kubeconfig and update server URL
ssh -o BatchMode=yes -o ConnectTimeout="$SSH_CONNECT_TIMEOUT_SECONDS" "$SERVER_USERNAME@$SERVER_IP" \
  'sudo cat /etc/rancher/k3s/k3s.yaml' | \
  sed "s/127.0.0.1/$K8S_HOSTNAME/" > "$tmp_kubeconfig"

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
