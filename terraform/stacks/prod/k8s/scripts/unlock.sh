#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

if [[ -z "${1-}" ]]; then
  echo "Usage: $0 <LOCK_ID>"
  echo "You can find the LOCK_ID in the 'terraform apply' error message."
  exit 1
fi

LOCK_ID="$1"
BACKEND_CONFIG=$(get_backend_config)

echo "Attempting to force-unlock state for LOCK_ID: $LOCK_ID"
echo "Initializing Terraform to configure backend..."

# We need to initialize first to tell Terraform where the state is.
terraform -chdir="$STACK_DIR" init -backend-config="$BACKEND_CONFIG"

# Now, force-unlock the state.
terraform -chdir="$STACK_DIR" force-unlock "$LOCK_ID"

echo "Unlock command sent. Please try your operation again."
