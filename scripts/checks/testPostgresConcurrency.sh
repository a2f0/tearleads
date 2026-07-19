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
# adapter accepts only DATABASE_URL or the complete POSTGRES_* set.
if [ -z "${DATABASE_URL:-}${POSTGRES_URL:-}" ]; then
  DATABASE_URL=postgres://localhost:5432/tearleads_concurrency_test
  export DATABASE_URL
  if command -v createdb >/dev/null 2>&1; then
    createdb tearleads_concurrency_test 2>/dev/null || true
  fi
fi

# Workspace packages must already be built (bun run build:packages); the lane
# itself only runs the multi-connection concurrency tests.
cd packages/api
exec bun test src/routes/documents/syncConcurrency.pg.test.ts
