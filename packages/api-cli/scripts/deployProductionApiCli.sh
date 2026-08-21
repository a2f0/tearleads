#!/usr/bin/env bash
# Deploy the SymCrypt API CLI executable to the production server.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

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

echo "Building API CLI executable..."
(cd "$REPO_ROOT/packages/api-cli" && bun run build)

REMOTE_BIN_PATH="/opt/symcrypt/bin"

echo "Deploying API CLI executable to $SSH_TARGET:$REMOTE_BIN_PATH ..."
ssh "$SSH_TARGET" mkdir -p "$REMOTE_BIN_PATH"
rsync -avz "$REPO_ROOT/packages/api-cli/dist/symcrypt-api-cli" \
  "$SSH_TARGET:$REMOTE_BIN_PATH/"

echo "API CLI deployed."
