#!/bin/sh
set -eu

cd "$(dirname "$0")/../../.."

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

# Build the client
pnpm --filter @rapid/client build

# Upload to server
rsync -avz --delete \
  packages/client/dist/ \
  "${USERNAME}@${HOSTNAME}:/var/www/app/"

# Set permissions for nginx
ssh "${USERNAME}@${HOSTNAME}" \
  "sudo chown -R www-data:www-data /var/www/app && sudo chmod -R 755 /var/www/app"

# shellcheck disable=SC2154 # validated by set -u
echo "Deployed to https://app.${TF_VAR_domain}"
