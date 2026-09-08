#!/bin/sh
# Destroy the staging server, then empty and destroy its independent S3 storage.
# Usage: scripts/destroyStaging.sh [terraform destroy arguments...]
# Terraform asks for confirmation unless --auto-approve is passed.

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
"$REPO_ROOT/terraform/stacks/staging/server/scripts/destroy.sh" "$@"
exec "$REPO_ROOT/terraform/scripts/run-storage-stack.sh" staging destroy "$@"
