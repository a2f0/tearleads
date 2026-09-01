#!/usr/bin/env bash
# Deploy the Tearleads API to the production server
#
# Builds and deploys standalone API executables, runs database migrations,
# and starts the API service after the migration window.

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
PRODUCTION_SSH_TARGET="$SSH_TARGET"
export PRODUCTION_SSH_TARGET

REMOTE_BIN_PATH="/opt/tearleads/bin"
REMOTE_STAGE_PATH="$REMOTE_BIN_PATH/.deploy-$(git rev-parse --short=12 HEAD)-$$"

echo "Building API executable..."
(cd "$REPO_ROOT/packages/api" && bun run build)

bash "$REPO_ROOT/packages/api-cli/scripts/deployProductionApiCli.sh"

echo "Staging API executables at $SSH_TARGET:$REMOTE_STAGE_PATH ..."
ssh "$SSH_TARGET" mkdir -p "$REMOTE_BIN_PATH" "$REMOTE_STAGE_PATH"
rsync -avz \
  "$REPO_ROOT/packages/api/dist/tearleads-api" \
  "$REPO_ROOT/packages/api/dist/tearleads-blob-gc" \
  "$REPO_ROOT/packages/api/dist/tearleads-stripe-seat-sync" \
  "$SSH_TARGET:$REMOTE_STAGE_PATH/"
ssh "$SSH_TARGET" sh -s -- "$REMOTE_STAGE_PATH" <<'REMOTE_VERIFY'
set -eu
remote_stage_path="$1"
test -x "$remote_stage_path/tearleads-api"
test -x "$remote_stage_path/tearleads-blob-gc"
test -x "$remote_stage_path/tearleads-stripe-seat-sync"
REMOTE_VERIFY

echo "Stopping API database writers for the breaking migration window..."
ssh "$SSH_TARGET" "sudo systemctl stop tearleads-api tearleads-blob-gc.timer tearleads-blob-gc.service tearleads-stripe-seat-sync.timer tearleads-stripe-seat-sync.service"

echo "Installing staged API executables atomically..."
ssh "$SSH_TARGET" sh -s -- "$REMOTE_STAGE_PATH" "$REMOTE_BIN_PATH" <<'REMOTE_INSTALL'
set -eu
remote_stage_path="$1"
remote_bin_path="$2"
mv -f "$remote_stage_path/tearleads-api" "$remote_bin_path/tearleads-api"
mv -f "$remote_stage_path/tearleads-blob-gc" "$remote_bin_path/tearleads-blob-gc"
mv -f "$remote_stage_path/tearleads-stripe-seat-sync" "$remote_bin_path/tearleads-stripe-seat-sync"
rmdir "$remote_stage_path"
REMOTE_INSTALL

echo "Running database migrations..."
ssh "$SSH_TARGET" 'set -eu && set -a && . /etc/tearleads/api.env && set +a && /opt/tearleads/bin/tearleads-api-cli migrate'

echo "Starting API service and maintenance timers..."
ssh "$SSH_TARGET" "sudo systemctl start tearleads-api tearleads-blob-gc.timer tearleads-stripe-seat-sync.timer"

echo "API deployed."
