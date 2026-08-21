#!/usr/bin/env bash
# Deploy the symcrypt-code-assist webhook server to the staging server.
#
# Builds the standalone executable, ships it, and restarts the service. The env
# file, private key, systemd unit, and tunnel ingress are provisioned by the
# Ansible playbook + Terraform; this script only ships the binary.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../terraform/scripts/common.sh
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

echo "Building code-assist executable..."
(cd "$REPO_ROOT/packages/code-assist" && bun run build)

echo "Deploying code-assist executable to $SSH_TARGET:$REMOTE_BIN_PATH ..."
ssh "$SSH_TARGET" mkdir -p "$REMOTE_BIN_PATH"
rsync -avz "$REPO_ROOT/packages/code-assist/dist/symcrypt-code-assist" \
  "$SSH_TARGET:$REMOTE_BIN_PATH/"

echo "Restarting code-assist service..."
ssh "$SSH_TARGET" "sudo systemctl restart symcrypt-code-assist"

echo "code-assist deployed."
