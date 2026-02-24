#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod

if [[ -z "${1-}" ]]; then
  echo "Usage: $0 <LOCK_ID>"
  echo "You can find the LOCK_ID in the 'terraform apply' error message."
  exit 1
fi

LOCK_ID="$1"

echo "Attempting to force-unlock state for LOCK_ID: $LOCK_ID"

"$SCRIPT_DIR/init.sh"

terraform -chdir="$STACK_DIR" force-unlock "$LOCK_ID"

echo "Unlock command sent. Please try your operation again."
