#!/bin/sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"

# If no explicit PG env is set, dev mode defaults to localhost:5432.
# Fail fast with actionable guidance when local Postgres is unreachable.
HAS_PG_ENV=0
for key in DATABASE_URL POSTGRES_URL POSTGRES_HOST PGHOST POSTGRES_PORT PGPORT POSTGRES_USER PGUSER POSTGRES_DATABASE PGDATABASE; do
  eval "value=\${$key-}"
  if [ -n "${value}" ]; then
    HAS_PG_ENV=1
    break
  fi
done

if [ "${HAS_PG_ENV}" -eq 0 ] && command -v pg_isready >/dev/null 2>&1; then
  if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    echo "Postgres is not reachable at localhost:5432." >&2
    echo "Run ./scripts/setupPostgresDev.sh to provision/start local dev Postgres, then retry." >&2
    exit 1
  fi
fi

pnpm --filter @tearleads/api exec tsx "$ROOT_DIR/packages/api/src/apiCli.ts" migrate "$@"
