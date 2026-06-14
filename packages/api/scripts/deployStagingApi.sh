#!/usr/bin/env bash
# Deploy the Tearleads API to the staging server
#
# Builds and deploys standalone API executables, runs database migrations,
# and restarts the API service.

set -euo pipefail

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
REMOTE_BIN_PATH="/opt/tearleads/bin"

wait_for_ssh_ready "$SSH_TARGET"

echo "Building API executable..."
(cd "$REPO_ROOT/packages/api" && bun run build)

"$REPO_ROOT/packages/api-cli/scripts/deployStagingApiCli.sh"

echo "Deploying API executable to $SSH_TARGET:$REMOTE_BIN_PATH ..."
ssh "$SSH_TARGET" "mkdir -p $REMOTE_BIN_PATH"
rsync -avz "$REPO_ROOT/packages/api/dist/tearleads-api" \
  "$SSH_TARGET:$REMOTE_BIN_PATH/"

echo "Running database migrations..."
ssh "$SSH_TARGET" "set -a && . /etc/tearleads/api.env && set +a && $REMOTE_BIN_PATH/tearleads-api-cli migrate 2>&1"

echo "Restarting API service..."
ssh "$SSH_TARGET" "sudo systemctl restart tearleads-api"

echo "API deployed."
