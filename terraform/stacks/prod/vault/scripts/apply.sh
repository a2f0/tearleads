#!/bin/bash
# Full Vault provisioning: Terraform + Ansible
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Step 1/2: Applying Terraform infrastructure..."
"$SCRIPT_DIR/apply01.sh" "$@"

echo ""
echo "Step 2/2: Configuring Vault with Ansible..."
"$SCRIPT_DIR/apply02.sh"

echo ""
echo "All steps complete."
echo "If this is a new server, run: ./scripts/setup-vault.sh"
