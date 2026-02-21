#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

terraform -chdir="$STACK_DIR" init
terraform -chdir="$STACK_DIR" apply "$@"

echo ""
echo "IMPORTANT: Backup the state file immediately!"
echo "The bootstrap state is stored locally at: $STACK_DIR/terraform.tfstate"
echo "Consider storing a backup in a secure location (e.g., 1Password, encrypted backup)."
