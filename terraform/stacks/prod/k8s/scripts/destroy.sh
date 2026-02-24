#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env
setup_ssh_host_keys

echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo "!! WARNING: This will destroy the PRODUCTION k8s cluster.   !!"
echo "!! All production workloads and data will be PERMANENTLY    !!"
echo "!! LOST. This action CANNOT be undone.                      !!"
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo ""
echo "Press Ctrl+C to cancel, or wait 10 seconds to continue..."
sleep 10

"$SCRIPT_DIR/init.sh"
terraform -chdir="$STACK_DIR" destroy "$@"
