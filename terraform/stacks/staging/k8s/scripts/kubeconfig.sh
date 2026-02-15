#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

# Get outputs from Terraform
SERVER_IP=$(terraform -chdir="$STACK_DIR" output -raw server_ip)
SERVER_USERNAME=$(terraform -chdir="$STACK_DIR" output -raw server_username)
K8S_HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw k8s_hostname)

KUBECONFIG_FILE="${1:-$HOME/.kube/config-staging-k8s}"

echo "Fetching kubeconfig from $SERVER_USERNAME@$SERVER_IP..."

# Fetch kubeconfig and update server URL
ssh "$SERVER_USERNAME@$SERVER_IP" 'sudo cat /etc/rancher/k3s/k3s.yaml' | \
  sed "s/127.0.0.1/$K8S_HOSTNAME/" > "$KUBECONFIG_FILE"

chmod 600 "$KUBECONFIG_FILE"

echo "Kubeconfig saved to: $KUBECONFIG_FILE"
echo ""
echo "To use this cluster:"
echo "  export KUBECONFIG=$KUBECONFIG_FILE"
echo "  kubectl get nodes"
