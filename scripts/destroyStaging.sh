#!/bin/sh
# Destroy the staging hostnames, Workers, database, R2 storage, and the
# independently hosted website.
# Usage: scripts/destroyStaging.sh [--auto-approve]
# Without --auto-approve the script asks once, up front, for the whole
# teardown. Terraform's own prompts would come after the Workers were deleted
# and the database's objects dropped, too late to decline anything.

set -eu

AUTO_APPROVE=0
for argument in "$@"; do
  case "$argument" in
    -auto-approve | --auto-approve) AUTO_APPROVE=1 ;;
    *)
      echo "Usage: scripts/destroyStaging.sh [--auto-approve]" >&2
      echo "Use the individual stack wrappers for partial Terraform operations." >&2
      exit 1
      ;;
  esac
done

if [ "$AUTO_APPROVE" -eq 0 ]; then
  echo "This destroys every staging resource: hostnames, Workers, the database and everything in it, R2 storage, and the website." >&2
  printf 'Type "staging" to continue: ' >&2
  IFS= read -r answer || answer=""
  if [ "$answer" != "staging" ]; then
    echo "Teardown cancelled; nothing was changed." >&2
    exit 1
  fi
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
"$REPO_ROOT/terraform/scripts/run-edge-stack.sh" staging destroy --auto-approve
"$REPO_ROOT/packages/api/scripts/destroyStagingApi.sh"
"$REPO_ROOT/packages/app-web/scripts/destroyStagingAppWeb.sh"
# PlanetScale refuses to delete a role that still owns objects.
"$REPO_ROOT/terraform/scripts/drop-postgres-owned.sh" staging
"$REPO_ROOT/terraform/scripts/run-postgres-stack.sh" staging destroy --auto-approve
"$REPO_ROOT/terraform/scripts/empty-staging-blobs.sh"
"$REPO_ROOT/terraform/scripts/run-storage-stack.sh" staging destroy --auto-approve
exec "$REPO_ROOT/packages/website/scripts/destroyStagingWebsite.sh" --auto-approve
