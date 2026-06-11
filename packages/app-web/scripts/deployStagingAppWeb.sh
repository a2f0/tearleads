#!/usr/bin/env bash
# Deploy the Tearleads app-web to the staging server
#
# Builds the client bundle with staging API URLs, syncs the monorepo
# source to the staging server, installs dependencies, and restarts
# the app-web service.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../terraform/scripts/common.sh
. "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging
validate_aws_env

STACK_DIR="$REPO_ROOT/terraform/stacks/staging/server"
BACKEND_CONFIG="$(get_backend_config)"
terraform -chdir="$STACK_DIR" init -backend-config="$BACKEND_CONFIG" >&2

HOSTNAME=$(terraform -chdir="$STACK_DIR" output -raw ssh_hostname 2>/dev/null) || true
USERNAME=$(terraform -chdir="$STACK_DIR" output -raw server_username 2>/dev/null) || true
DOMAIN="${TF_VAR_domain:-}"

if [ -z "$HOSTNAME" ] || [ -z "$USERNAME" ]; then
  echo "ERROR: Could not resolve hostname or username from terraform outputs." >&2
  echo "       Run 'terraform apply' in $STACK_DIR first." >&2
  exit 1
fi

echo "Building app-web..."
BUN_PUBLIC_API_BASE_URL="https://api.${DOMAIN}" \
  BUN_PUBLIC_WS_URL="wss://api.${DOMAIN}" \
  (cd "$REPO_ROOT/packages/app-web" && bun run build)

SSH_TARGET="$USERNAME@$HOSTNAME"
REMOTE_PATH="/opt/tearleads"

wait_for_ssh_ready "$SSH_TARGET"

echo "Deploying source to $SSH_TARGET:$REMOTE_PATH ..."
rsync -avz --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.turbo/' \
  --exclude='build/' \
  --exclude='.astro/' \
  --exclude='*.tsbuildinfo' \
  --exclude='playwright-report/' \
  --exclude='test-results/' \
  "$REPO_ROOT/" "$SSH_TARGET:$REMOTE_PATH/"

echo "Installing dependencies..."
ssh "$SSH_TARGET" "cd $REMOTE_PATH && ~/.bun/bin/bun install 2>&1"

echo "Syncing built workspace dist directories..."
rsync -avz --delete \
  "$REPO_ROOT/packages/sqlite-instance/dist/" \
  "$SSH_TARGET:$REMOTE_PATH/packages/sqlite-instance/dist/"
rsync -avz --delete \
  "$REPO_ROOT/packages/client-sdk/dist/" \
  "$SSH_TARGET:$REMOTE_PATH/packages/client-sdk/dist/"
rsync -avz --delete \
  "$REPO_ROOT/packages/app-web/dist/" \
  "$SSH_TARGET:$REMOTE_PATH/packages/app-web/dist/"

echo "Restarting app-web service..."
ssh "$SSH_TARGET" "sudo systemctl restart tearleads-app-web"

echo "App-web deployed."

if [ -n "$DOMAIN" ]; then
  purge_cloudflare_cache_for_hosts "$DOMAIN" "app.${DOMAIN}"
fi
