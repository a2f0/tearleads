#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging
setup_ssh_host_keys

echo "WARNING: This will destroy the staging k8s cluster."
echo "All workloads and data on this cluster will be lost."
echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
sleep 5

terraform -chdir="$STACK_DIR" destroy "$@"
