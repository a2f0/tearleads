#!/bin/sh
# Destroy the staging server, then empty and destroy its independent S3 storage.
# Usage: scripts/destroyStaging.sh [--auto-approve]
# Terraform asks for confirmation unless --auto-approve is passed.

set -eu

for argument in "$@"; do
  case "$argument" in
    -auto-approve | --auto-approve) ;;
    *)
      echo "Usage: scripts/destroyStaging.sh [--auto-approve]" >&2
      echo "Use the individual stack wrappers for partial Terraform operations." >&2
      exit 1
      ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel)"
"$REPO_ROOT/terraform/stacks/staging/server/scripts/destroy.sh" "$@"
exec "$REPO_ROOT/terraform/scripts/run-storage-stack.sh" staging destroy "$@"
