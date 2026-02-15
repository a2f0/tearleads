#!/bin/sh
set -eu
export TF_WORKSPACE="${TF_WORKSPACE_K8S:?TF_WORKSPACE_K8S is not set}"

cd "$(dirname "$0")/.."
SERVER_IP=$(terraform output -raw server_ip)
USERNAME=$(terraform output -raw server_username)
DOMAIN="${TF_VAR_domain:?TF_VAR_domain is not set}"

VITE_API_URL="https://api.k8s.${DOMAIN}/v1"

echo "Building images on ${SERVER_IP}..."

# Sync repo to server
echo "Syncing repository..."
rsync -az --delete \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=dist \
  --exclude=.turbo \
  ../../ "${USERNAME}@${SERVER_IP}:/opt/tearleads/"

# Build images using nerdctl (k3s containerd)
echo "Building API image..."
ssh "${USERNAME}@${SERVER_IP}" "cd /opt/tearleads && sudo nerdctl build -t localhost/tearleads-api:latest -f packages/api/Dockerfile ."

echo "Building client image..."
ssh "${USERNAME}@${SERVER_IP}" "cd /opt/tearleads && sudo nerdctl build --build-arg VITE_API_URL=${VITE_API_URL} -t localhost/tearleads-client:latest -f packages/client/Dockerfile ."

echo "Building website image..."
ssh "${USERNAME}@${SERVER_IP}" "cd /opt/tearleads && sudo nerdctl build -t localhost/tearleads-website:latest -f packages/website/Dockerfile ."

echo "Images built successfully!"
