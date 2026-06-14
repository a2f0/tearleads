#!/usr/bin/env bash
# Deploy the Tearleads website to the staging server
#
# Builds the Astro website, resolves the staging server hostname and
# username from Terraform outputs, and deploys the static files via rsync.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"
WEBSITE_DIR="$REPO_ROOT/packages/website"

# shellcheck source=../../../../terraform/scripts/common.sh
. "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging
validate_aws_env

echo "Building website..."
(cd "$WEBSITE_DIR" && bun run build)

STACK_DIR="$REPO_ROOT/terraform/stacks/staging/server"
BACKEND_CONFIG="$(get_backend_config)"
terraform -chdir="$STACK_DIR" init -backend-config="$BACKEND_CONFIG" >&2

SSH_TARGET="$(resolve_stack_ssh_target "$STACK_DIR")"
REMOTE_PATH="/var/www/website"

echo "Deploying website to $SSH_TARGET:$REMOTE_PATH ..."
rsync -avz --delete --rsync-path="sudo rsync" \
  "$WEBSITE_DIR/dist/" "$SSH_TARGET:$REMOTE_PATH/"

ssh "$SSH_TARGET" "sudo chown -R www-data:www-data $REMOTE_PATH"
ssh "$SSH_TARGET" "sudo systemctl reload nginx"

echo "Website deployed."

# Purge Cloudflare cache for the main domain if available
DOMAIN="${TF_VAR_domain:-}"
if [ -n "$DOMAIN" ]; then
  purge_cloudflare_cache_for_hosts "$DOMAIN" "$DOMAIN"
fi
