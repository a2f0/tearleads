#!/usr/bin/env bash
# Deploy the SymCrypt API to the staging server
#
# Builds and deploys standalone API executables, runs database migrations,
# and restarts the API service.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging
validate_aws_env

if [ -z "${SSH_TARGET:-}" ]; then
  STACK_DIR="$REPO_ROOT/terraform/stacks/staging/server"
  BACKEND_CONFIG="$(get_backend_config)"
  terraform -chdir="$STACK_DIR" init -backend-config="$BACKEND_CONFIG" >&2
  SSH_TARGET="$(resolve_stack_ssh_target "$STACK_DIR")"
fi
export SSH_TARGET

REMOTE_BIN_PATH="/opt/symcrypt/bin"

echo "Building API executable..."
(cd "$REPO_ROOT/packages/api" && bun run build)

bash "$REPO_ROOT/packages/api-cli/scripts/deployStagingApiCli.sh"

echo "Deploying API executable to $SSH_TARGET:$REMOTE_BIN_PATH ..."
ssh "$SSH_TARGET" mkdir -p "$REMOTE_BIN_PATH"
rsync -avz \
  "$REPO_ROOT/packages/api/dist/symcrypt-api" \
  "$REPO_ROOT/packages/api/dist/symcrypt-blob-gc" \
  "$REPO_ROOT/packages/api/dist/symcrypt-stripe-seat-sync" \
  "$SSH_TARGET:$REMOTE_BIN_PATH/"

echo "Running database migrations..."
ssh "$SSH_TARGET" 'set -a && . /etc/symcrypt/api.env && set +a && /opt/symcrypt/bin/symcrypt-api-cli migrate 2>&1'

echo "Restarting API service..."
ssh "$SSH_TARGET" "sudo systemctl restart symcrypt-api"

echo "API deployed."
