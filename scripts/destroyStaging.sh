#!/bin/sh
# Destroy the staging hostnames, Workers, database, S3 storage, and the
# independently hosted website.
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
"$REPO_ROOT/terraform/scripts/run-edge-stack.sh" staging destroy "$@"
"$REPO_ROOT/packages/api/scripts/destroyStagingApi.sh"
"$REPO_ROOT/packages/app-web/scripts/destroyStagingAppWeb.sh"
"$REPO_ROOT/terraform/scripts/run-postgres-stack.sh" staging destroy "$@"
"$REPO_ROOT/terraform/scripts/run-storage-stack.sh" staging destroy "$@"
exec "$REPO_ROOT/packages/website/scripts/destroyStagingWebsite.sh" "$@"
