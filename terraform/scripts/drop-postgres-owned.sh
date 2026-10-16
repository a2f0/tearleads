#!/usr/bin/env bash
# Drop every object the staging migration login owns so PlanetScale can delete
# its roles when the staging Postgres stack is destroyed. Production keeps the
# documented manual procedure in docs/developer/greenfield-reset.md.
set -euo pipefail

if [[ "${1:-}" != staging ]]; then
  echo "Usage: $(basename "$0") staging" >&2
  echo "Only the disposable staging database can be emptied through this wrapper." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=./common.sh
# shellcheck disable=SC1091
source "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env staging
validate_tf_state_env

umask 077
CONNECTION_FILE="$(mktemp "${TMPDIR:-/tmp}/tearleads-staging-postgres-XXXXXX")"
trap 'rm -f "$CONNECTION_FILE"' EXIT
"$REPO_ROOT/terraform/scripts/run-postgres-stack.sh" staging output -json api_connection >"$CONNECTION_FILE"

read_connection() {
  jq -r --arg key "$1" '.[$key] // empty' "$CONNECTION_FILE"
}

echo "Dropping the objects owned by the staging migration login..."
(
  # The password assignment must not appear in a traced run; the subshell
  # keeps the change local.
  if [[ "$-" == *x* ]]; then
    set +x
  fi
  export POSTGRES_HOST POSTGRES_PORT POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DATABASE
  POSTGRES_HOST="$(read_connection postgres_host)"
  POSTGRES_PORT="$(read_connection postgres_migration_port)"
  POSTGRES_USER="$(read_connection postgres_migration_user)"
  POSTGRES_PASSWORD="$(read_connection postgres_migration_password)"
  POSTGRES_DATABASE="$(read_connection postgres_db)"
  cd "$REPO_ROOT/packages/api-shared"
  bun scripts/dropOwnedObjects.ts
)
