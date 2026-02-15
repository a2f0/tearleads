#!/bin/sh
set -eu
export TF_WORKSPACE="${TF_WORKSPACE_K8S:?TF_WORKSPACE_K8S is not set}"

KUBECONFIG_DIR="${HOME}/.kube"
KUBECONFIG_FILE="${KUBECONFIG_DIR}/config-k8s"

cd "$(dirname "$0")/.."
SERVER_IP=$(terraform output -raw server_ip)
USERNAME=$(terraform output -raw server_username)

mkdir -p "$KUBECONFIG_DIR"
ssh "${USERNAME}@${SERVER_IP}" "sudo cat /etc/rancher/k3s/k3s.yaml" | \
  sed "s/127.0.0.1/${SERVER_IP}/g" > "$KUBECONFIG_FILE"
chmod 600 "$KUBECONFIG_FILE"

echo "Kubeconfig written to ${KUBECONFIG_FILE}"
echo "Run: export KUBECONFIG=${KUBECONFIG_FILE}"
