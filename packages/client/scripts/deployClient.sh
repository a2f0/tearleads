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

# Upload to server (user is in www-data group with write access)
rsync -avz --delete --chmod=D750,F640 \
  packages/client/dist/ \
  "${USERNAME}@${HOSTNAME}:/var/www/app/"

# shellcheck disable=SC2154 # validated by set -u
echo "Deployed to https://app.${TF_VAR_domain}"
