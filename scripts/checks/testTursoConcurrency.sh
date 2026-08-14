#!/usr/bin/env sh

set -eu

fail() {
  echo "Error: $*" >&2
  exit 1
}

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) ||
  fail "The Turso concurrency lane must run inside a Git repository."

cd "$REPO_ROOT"

[ -n "${TURSO_TEST_DATABASE_URL:-}" ] ||
  fail "TURSO_TEST_DATABASE_URL must identify a dedicated remote test database."
[ -n "${TURSO_TEST_AUTH_TOKEN:-}" ] ||
  fail "TURSO_TEST_AUTH_TOKEN is required for the dedicated test database."

case "$TURSO_TEST_DATABASE_URL" in
  libsql://*) ;;
  *)
    fail "TURSO_TEST_DATABASE_URL must use libsql://; embedded replicas and local files are not supported."
    ;;
esac

API_DATABASE=turso
TURSO_DATABASE_URL=$TURSO_TEST_DATABASE_URL
TURSO_AUTH_TOKEN=$TURSO_TEST_AUTH_TOKEN
export API_DATABASE TURSO_AUTH_TOKEN TURSO_DATABASE_URL

# The test database is migrated in the API test preload. Use a disposable or
# dedicated Turso database because the parity and concurrency cases retain
# randomized rows.
cd packages/api
exec bun test \
  src/routes/documents/syncConcurrency.pg.test.ts \
  src/workflows/organizations/readModelChanges.test.ts
