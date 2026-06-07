#!/bin/sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/../.." && pwd -P)"

has_pg_env=0
for key in DATABASE_URL POSTGRES_URL POSTGRES_HOST PGHOST POSTGRES_PORT PGPORT POSTGRES_USER PGUSER POSTGRES_DATABASE PGDATABASE; do
  eval "value=\${$key-}"
  if [ -n "${value}" ]; then
    has_pg_env=1
    break
  fi
done

if [ "${has_pg_env}" -eq 0 ] && command -v pg_isready >/dev/null 2>&1; then
  pg_ready=1
  if [ "$(uname -s)" = "Linux" ] && [ -d "/var/run/postgresql" ]; then
    if pg_isready -h /var/run/postgresql -p 5432 >/dev/null 2>&1; then
      pg_ready=0
    fi
  fi
  if [ "${pg_ready}" -ne 0 ] && pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    pg_ready=0
  fi
  if [ "${pg_ready}" -ne 0 ]; then
    if [ "$(uname -s)" = "Linux" ]; then
      echo "Postgres is not reachable at /var/run/postgresql or localhost:5432." >&2
    else
      echo "Postgres is not reachable at localhost:5432." >&2
    fi
    echo "Run sh scripts/postgres/setupPostgresDev.sh first, then retry." >&2
    exit 1
  fi
fi

API_DATABASE="${API_DATABASE:-postgres}" bun "$ROOT_DIR/packages/api/src/scripts/migratePostgres.ts" "$@"
