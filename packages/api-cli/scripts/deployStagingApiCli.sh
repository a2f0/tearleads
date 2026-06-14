#!/usr/bin/env bash
# Deploy the Tearleads API CLI executable to the staging server.

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

echo "Building API CLI executable..."
(cd "$REPO_ROOT/packages/api-cli" && bun run build)

SSH_TARGET="$USERNAME@$HOSTNAME"
REMOTE_BIN_PATH="/opt/tearleads/bin"

wait_for_ssh_ready "$SSH_TARGET"

echo "Deploying API CLI executable to $SSH_TARGET:$REMOTE_BIN_PATH ..."
ssh "$SSH_TARGET" "mkdir -p $REMOTE_BIN_PATH"
rsync -avz "$REPO_ROOT/packages/api-cli/dist/tearleads-api-cli" \
  "$SSH_TARGET:$REMOTE_BIN_PATH/"

echo "API CLI deployed."
