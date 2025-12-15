#!/bin/sh
set -eu

cd "$(dirname "$0")/../../.."

# Get server hostname from Terraform
HOSTNAME=$(cd terraform && terraform output -raw hostname)

if [ -z "$HOSTNAME" ]; then
  echo "Error: Could not get hostname from Terraform output"
  exit 1
fi

# Build the client
pnpm --filter @rapid/client build

# Upload to server
rsync -avz --delete \
  -e "ssh -o StrictHostKeyChecking=no" \
  packages/client/dist/ \
  "root@${HOSTNAME}:/var/www/app/"

# Set permissions for nginx
ssh -o StrictHostKeyChecking=no "root@${HOSTNAME}" \
  "chown -R www-data:www-data /var/www/app && chmod -R 755 /var/www/app"

# shellcheck disable=SC2154 # validated by set -u
echo "Deployed to https://app.${TF_VAR_domain}"
