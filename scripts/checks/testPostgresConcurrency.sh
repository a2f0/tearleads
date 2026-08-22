#!/usr/bin/env sh

set -eu

fail() {
  echo "Error: $*" >&2
  exit 1
}

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) ||
  fail "The Postgres concurrency lane must run inside a Git repository."

cd "$REPO_ROOT"

[ "${API_DATABASE:-postgres}" = "postgres" ] ||
  fail "API_DATABASE must be postgres for the concurrency lane."
API_DATABASE=postgres
export API_DATABASE

# Never write into a development database by default: when no explicit target
# is configured, aim at a dedicated local database and create it when
# possible. A full URL is required — bun test sets NODE_ENV=test, where the
# adapter accepts only DATABASE_URL or the complete POSTGRES_* set — so the
# default is only injected when neither a URL nor any discrete POSTGRES_*
# setting is present.
if [ -z "${DATABASE_URL:-}${POSTGRES_URL:-}${POSTGRES_HOST:-}${POSTGRES_PORT:-}${POSTGRES_USER:-}${POSTGRES_PASSWORD:-}${POSTGRES_DATABASE:-}" ]; then
  DATABASE_URL=postgres://localhost:5432/symcrypt_concurrency_test
  export DATABASE_URL
  if command -v createdb >/dev/null 2>&1; then
    # Pin createdb to the same local server as the injected URL — bare createdb
    # follows inherited libpq PG* variables and could target a remote server.
    createdb -h localhost -p 5432 symcrypt_concurrency_test 2>/dev/null || true
  fi
fi

# Workspace packages must already be built (bun run build:packages); the lane
# itself only runs the multi-connection concurrency tests.
cd packages/api
exec bun test \
  src/routes/documents/syncConcurrency.pg.test.ts \
  src/workflows/blobs/gc/reclaimDereferencedBlobs.test.ts \
  src/workflows/blobs/gc/pendingBlobObjectDeletion.test.ts \
  src/workflows/blobs/mutations/authorization.test.ts \
  src/workflows/blobs/mutations/authorizationAncestors.pg.test.ts \
  src/workflows/blobs/mutations/blobMutationLocks.test.ts \
  src/workflows/blobs/mutations/finalizeAttachmentMutation.pg.test.ts \
  src/workflows/blobs/mutations/persistenceTimestamp.pg.test.ts \
  src/workflows/containers/deleteContainerTimestamp.pg.test.ts
