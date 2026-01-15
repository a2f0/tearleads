#!/bin/sh
set -eu
SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)

cd "$SCRIPT_DIR/.."

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

# Build the bundled API (single file, no node_modules needed)
pnpm --filter @rapid/api build:bundle

# Upload bundled files to server
echo "Deploying to ${HOSTNAME}..."
ssh "${USERNAME}@${HOSTNAME}" "mkdir -p /opt/rapid-api/dist"
rsync -avz --delete \
  packages/api/dist/ \
  "${USERNAME}@${HOSTNAME}:/opt/rapid-api/dist/"

# Set ownership and permissions
ssh "${USERNAME}@${HOSTNAME}" "chgrp -R www-data /opt/rapid-api && chmod -R u=rwX,g=rX,o= /opt/rapid-api"

# Restart service
ssh "${USERNAME}@${HOSTNAME}" <<'REMOTE'
sudo systemctl restart rapid-api
sudo systemctl --no-pager status rapid-api
REMOTE

echo "API deployed to https://api.${TF_VAR_domain}"
