#!/usr/bin/env bash
# Deploy the SymCrypt API to the staging server
#
# Builds and deploys standalone API executables, runs database migrations,
# and starts the API service after the migration window.

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
REMOTE_STAGE_PATH="$REMOTE_BIN_PATH/.deploy-$(git rev-parse --short=12 HEAD)-$$"

echo "Building API executable..."
(cd "$REPO_ROOT/packages/api" && bun run build)

bash "$REPO_ROOT/packages/api-cli/scripts/deployStagingApiCli.sh"

echo "Staging API executables at $SSH_TARGET:$REMOTE_STAGE_PATH ..."
ssh "$SSH_TARGET" mkdir -p "$REMOTE_BIN_PATH" "$REMOTE_STAGE_PATH"
rsync -avz \
  "$REPO_ROOT/packages/api/dist/symcrypt-api" \
  "$REPO_ROOT/packages/api/dist/symcrypt-blob-gc" \
  "$REPO_ROOT/packages/api/dist/symcrypt-stripe-seat-sync" \
  "$SSH_TARGET:$REMOTE_STAGE_PATH/"
ssh "$SSH_TARGET" sh -s -- "$REMOTE_STAGE_PATH" <<'REMOTE_VERIFY'
set -eu
remote_stage_path="$1"
test -x "$remote_stage_path/symcrypt-api"
test -x "$remote_stage_path/symcrypt-blob-gc"
test -x "$remote_stage_path/symcrypt-stripe-seat-sync"
REMOTE_VERIFY

echo "Stopping API database writers for the breaking migration window..."
ssh "$SSH_TARGET" "sudo systemctl stop symcrypt-api symcrypt-blob-gc.timer symcrypt-blob-gc.service symcrypt-stripe-seat-sync.timer symcrypt-stripe-seat-sync.service"

echo "Installing staged API executables atomically..."
ssh "$SSH_TARGET" sh -s -- "$REMOTE_STAGE_PATH" "$REMOTE_BIN_PATH" <<'REMOTE_INSTALL'
set -eu
remote_stage_path="$1"
remote_bin_path="$2"
mv -f "$remote_stage_path/symcrypt-api" "$remote_bin_path/symcrypt-api"
mv -f "$remote_stage_path/symcrypt-blob-gc" "$remote_bin_path/symcrypt-blob-gc"
mv -f "$remote_stage_path/symcrypt-stripe-seat-sync" "$remote_bin_path/symcrypt-stripe-seat-sync"
rmdir "$remote_stage_path"
REMOTE_INSTALL

echo "Running database migrations..."
ssh "$SSH_TARGET" 'set -eu && set -a && . /etc/symcrypt/api.env && set +a && /opt/symcrypt/bin/symcrypt-api-cli migrate'

echo "Starting API service and maintenance timers..."
ssh "$SSH_TARGET" "sudo systemctl start symcrypt-api symcrypt-blob-gc.timer symcrypt-stripe-seat-sync.timer"

echo "API deployed."
