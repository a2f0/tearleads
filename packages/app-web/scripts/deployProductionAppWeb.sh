#!/usr/bin/env bash
# Deploy the Tearleads app-web to the production server
#
# Builds the client bundle with production API URLs and deploys the
# static files served by nginx.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
APP_WEB_DIR="$REPO_ROOT/packages/app-web"

# shellcheck source=../../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod
validate_aws_env

if [ -z "${SSH_TARGET:-}" ]; then
  STACK_DIR="$REPO_ROOT/terraform/stacks/prod/server"
  BACKEND_CONFIG="$(get_backend_config)"
  terraform -chdir="$STACK_DIR" init -backend-config="$BACKEND_CONFIG" >&2
  SSH_TARGET="$(resolve_stack_ssh_target "$STACK_DIR")"
fi
export SSH_TARGET

DOMAIN="${TF_VAR_domain:-}"

if [ -z "$DOMAIN" ]; then
  echo "ERROR: TF_VAR_domain is required to build production app-web URLs." >&2
  exit 1
fi

echo "Building app-web..."
(cd "$APP_WEB_DIR" && \
  BUN_PUBLIC_API_BASE_URL="https://api.${DOMAIN}" \
  BUN_PUBLIC_WS_URL="wss://api.${DOMAIN}" \
  bun run build)

REMOTE_PATH="/var/www/app-web"

echo "Deploying app-web static files to $SSH_TARGET:$REMOTE_PATH ..."
ssh "$SSH_TARGET" sudo mkdir -p "$REMOTE_PATH"
rsync -avz --no-owner --no-group --delete --rsync-path="sudo rsync" \
  "$APP_WEB_DIR/dist/" "$SSH_TARGET:$REMOTE_PATH/"

ssh "$SSH_TARGET" sudo chown -R www-data:www-data "$REMOTE_PATH"
ssh "$SSH_TARGET" sudo systemctl reload nginx

echo "App-web deployed."

if [ -n "$DOMAIN" ]; then
  purge_cloudflare_cache_for_hosts "$DOMAIN" "app.${DOMAIN}"
fi
