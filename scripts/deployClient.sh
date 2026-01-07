#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

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

if [ -z "${VITE_API_URL:-}" ]; then
  echo "Error: VITE_API_URL environment variable is not set"
  exit 1
fi

if [ -z "${TF_VAR_domain:-}" ]; then
  echo "Error: TF_VAR_domain environment variable is not set"
  exit 1
fi

# Download SQLite WASM if not present
./scripts/downloadSqliteWasm.sh

# Generate web image assets
./packages/client/scripts/buildWebImageAssets.sh

# Build the client
pnpm --filter @rapid/client build

# Sync files, but protect assets/* from immediate deletion to avoid breaking
# users with cached HTML that references old hashed bundles
rsync -avz --delete --filter='P assets/*' \
  packages/client/dist/ \
  "${USERNAME}@${HOSTNAME}:/var/www/app/"

# Clean up assets older than 24 hours (1440 minutes)
ssh "${USERNAME}@${HOSTNAME}" "find /var/www/app/assets -type f -mmin +1440 -delete 2>/dev/null || true"

ssh "${USERNAME}@${HOSTNAME}" "chgrp -R www-data /var/www/app && chmod -R u=rwX,g=rX,o= /var/www/app"

echo "Deployed to https://app.${TF_VAR_domain}"
