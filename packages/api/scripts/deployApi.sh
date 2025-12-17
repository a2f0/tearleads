#!/bin/sh
set -eu

cd "$(dirname "$0")/../../.."

# Get server info from Terraform
HOSTNAME=$(cd terraform && terraform output -raw hostname)
USERNAME=$(cd terraform && terraform output -raw server_username)

if [ -z "${HOSTNAME:-}" ]; then
  echo "Error: Could not get hostname from Terraform output"
  exit 1
fi

if [ -z "${USERNAME:-}" ]; then
  echo "Error: Could not get server_username from Terraform output"
  exit 1
fi

if [ -z "${TF_VAR_domain:-}" ]; then
  echo "Error: TF_VAR_domain environment variable is not set"
  exit 1
fi

# Build shared package (API dependency)
pnpm --filter @rapid/shared build

# Build the API
pnpm --filter @rapid/api build

# Create deployment package using pnpm deploy
echo "Creating deployment package..."
DEPLOY_DIR=$(mktemp -d)
trap 'rm -rf "$DEPLOY_DIR"' EXIT

# Use pnpm deploy to create a deployment-ready package with all dependencies
pnpm --filter @rapid/api deploy "$DEPLOY_DIR"

# Upload to server
echo "Deploying to ${HOSTNAME}..."
rsync -avz --delete \
  "$DEPLOY_DIR/" \
  "${USERNAME}@${HOSTNAME}:/opt/rapid-api/"

# Set ownership and permissions
ssh "${USERNAME}@${HOSTNAME}" "chgrp -R www-data /opt/rapid-api && chmod -R u=rwX,g=rX,o= /opt/rapid-api"

# Restart service
ssh "${USERNAME}@${HOSTNAME}" <<'REMOTE'
sudo systemctl restart rapid-api
sudo systemctl --no-pager status rapid-api
REMOTE

echo "API deployed to https://api.${TF_VAR_domain}"
