#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod
validate_aws_env

echo "WARNING: This will destroy the production S3 bucket and IAM user!"
echo "All stored blobs will be lost."
echo "Press Ctrl+C to cancel, or wait 10 seconds to continue..."
sleep 10

"$SCRIPT_DIR/init.sh"
terraform -chdir="$STACK_DIR" destroy "$@"
