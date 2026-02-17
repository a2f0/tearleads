#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

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

echo "Fetching kubeconfig from $SERVER_USERNAME@$SERVER_IP..."

# Fetch kubeconfig and update server URL
ssh "$SERVER_USERNAME@$SERVER_IP" 'sudo cat /etc/rancher/k3s/k3s.yaml' | \
  sed "s/127.0.0.1/$K8S_API_HOSTNAME/" > "$KUBECONFIG_FILE"

chmod 600 "$KUBECONFIG_FILE"

echo "Kubeconfig saved to: $KUBECONFIG_FILE"
echo ""
echo "To use this cluster:"
echo "  export KUBECONFIG=$KUBECONFIG_FILE"
echo "  kubectl get nodes"
