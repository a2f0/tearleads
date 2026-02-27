#!/bin/bash
# Step 1: Apply Terraform infrastructure
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod
load_vault_token
setup_ssh_host_keys

terraform -chdir="$STACK_DIR" init -backend-config="$(get_backend_config)"
terraform -chdir="$STACK_DIR" apply "$@"
