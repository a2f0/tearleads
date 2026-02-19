#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

echo "Ansible VPN bootstrap has been removed."
echo "Step 2 is now a no-op."
echo "Terraform stack: $STACK_DIR"
