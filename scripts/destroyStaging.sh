#!/bin/sh
# Destroy the staging server stack and all its managed resources.
# Usage: scripts/destroyStaging.sh [terraform destroy arguments...]
# Terraform asks for confirmation unless --auto-approve is passed.

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
exec "$REPO_ROOT/terraform/stacks/staging/server/scripts/destroy.sh" "$@"
