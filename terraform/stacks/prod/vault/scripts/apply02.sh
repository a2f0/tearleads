#!/bin/bash
# Step 2: Configure Vault with Ansible
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod

SSH_TARGET="vault-prod"

echo "Waiting for SSH to become available on $SSH_TARGET..."
wait_for_ssh_ready "$SSH_TARGET"

echo "Waiting for cloud-init to complete..."
ssh "$SSH_TARGET" "sudo cloud-init status --wait" || true

if ! command -v ansible-playbook >/dev/null 2>&1; then
  echo "ERROR: ansible-playbook is required."
  echo "Install dependencies via ./ansible/scripts/setup.sh and re-run."
  exit 1
fi

echo "Running Ansible playbook to configure Vault..."
"$REPO_ROOT/ansible/scripts/run-vault-prod.sh"

echo ""
echo "Step 2 complete. Vault is configured."
echo "Next: Run ./scripts/setup-vault.sh to initialize Vault (first time only)."
