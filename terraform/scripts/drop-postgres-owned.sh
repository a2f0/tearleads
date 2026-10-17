#!/usr/bin/env bash
# Drop every object a tier's migration login owns so PlanetScale can delete its
# roles when the tier's Postgres stack is destroyed. Production runs this only
# under scripts/destroyProduction.sh (see teardownGuard.sh).
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $(basename "$0") <staging|prod>" >&2
  exit 1
fi
TIER="$1"

REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=./teardownGuard.sh
# shellcheck disable=SC1091
source "$REPO_ROOT/terraform/scripts/teardownGuard.sh"
require_teardown_authorized "$TIER"
# shellcheck source=./common.sh
# shellcheck disable=SC1091
source "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env "$TIER"
validate_tf_state_env

umask 077
CONNECTION_FILE="$(mktemp "${TMPDIR:-/tmp}/tearleads-$TIER-postgres-XXXXXX")"
trap 'rm -f "$CONNECTION_FILE"' EXIT
"$REPO_ROOT/terraform/scripts/run-postgres-stack.sh" "$TIER" output -json api_connection >"$CONNECTION_FILE"

read_connection() {
  jq -r --arg key "$1" '.[$key] // empty' "$CONNECTION_FILE"
}

echo "Dropping the objects owned by the $TIER migration login..."
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
