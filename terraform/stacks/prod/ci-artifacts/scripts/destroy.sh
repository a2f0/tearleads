#!/bin/bash
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"
STACK_NAME=$(basename "$STACK_DIR")
ENV_NAME=$(basename "$(dirname "$STACK_DIR")")

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env

echo "WARNING: This will destroy $ENV_NAME/$STACK_NAME."
echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
sleep 5

"$SCRIPT_DIR/init.sh"
terraform -chdir="$STACK_DIR" destroy "$@"
