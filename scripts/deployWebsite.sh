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

if [ -z "$HOSTNAME" ]; then
  echo "Error: Could not get hostname from Terraform output"
  exit 1
fi

if [ -z "$USERNAME" ]; then
  echo "Error: Could not get server_username from Terraform output"
  exit 1
fi

if [ -z "${TF_VAR_domain:-}" ]; then
  echo "Error: TF_VAR_domain environment variable is not set"
  exit 1
fi

: "${VITE_API_URL?Error: VITE_API_URL environment variable is not set}"

export VITE_API_URL

# Generate OpenAPI spec (needed by website for /docs page)
pnpm --filter @rapid/api buildOpenapi

# Build the website
pnpm --filter @rapid/website build

# Sync files, but protect /_astro/ directory from immediate deletion to avoid
# breaking users with cached HTML that references old hashed bundles
rsync -avz --delete --filter='P /_astro/' \
  packages/website/dist/ \
  "${USERNAME}@${HOSTNAME}:/var/www/www/"

# Clean up assets older than 7 days (10080 minutes) for consistency with client
ssh "${USERNAME}@${HOSTNAME}" "find /var/www/www/_astro -type f -mmin +10080 -delete 2>/dev/null || true"

ssh "${USERNAME}@${HOSTNAME}" "chgrp -R www-data /var/www/www && chmod -R u=rwX,g=rX,o= /var/www/www"

echo "Deployed to https://${TF_VAR_domain}"
