#!/usr/bin/env bash
# Deploy the Tearleads API to the staging server
#
# Syncs the monorepo source to the staging server, installs
# dependencies, runs database migrations, and restarts the API service.

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

if [ -z "$HOSTNAME" ] || [ -z "$USERNAME" ]; then
  echo "ERROR: Could not resolve hostname or username from terraform outputs." >&2
  echo "       Run 'terraform apply' in $STACK_DIR first." >&2
  exit 1
fi

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

echo "Running database migrations..."
ssh "$SSH_TARGET" "set -a && . /etc/tearleads/api.env && cd $REMOTE_PATH/packages/api && ~/.bun/bin/bun run db:migrate 2>&1"

echo "Restarting API service..."
ssh "$SSH_TARGET" "sudo systemctl restart tearleads-api"

echo "API deployed."
