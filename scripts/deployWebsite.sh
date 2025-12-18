#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

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

# Build the website
pnpm --filter @rapid/website build

rsync -avz --delete \
  packages/website/dist/ \
  "${USERNAME}@${HOSTNAME}:/var/www/www/"

ssh "${USERNAME}@${HOSTNAME}" "chgrp -R www-data /var/www/www && chmod -R u=rwX,g=rX,o= /var/www/www"

echo "Deployed to https://${TF_VAR_domain}"
