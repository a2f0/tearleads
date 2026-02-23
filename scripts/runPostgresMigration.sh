#!/bin/sh
set -eu

ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"

# If no explicit PG env is set, dev mode defaults to local Postgres.
# On Linux this prefers the local socket path for peer auth.
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
  PG_READY=1

  if [ "$(uname -s)" = "Linux" ] && [ -d "/var/run/postgresql" ]; then
    if pg_isready -h /var/run/postgresql -p 5432 >/dev/null 2>&1; then
      PG_READY=0
    fi
  fi

  if [ "${PG_READY}" -ne 0 ] && pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    PG_READY=0
  fi

  if [ "${PG_READY}" -ne 0 ]; then
    if [ "$(uname -s)" = "Linux" ]; then
      echo "Postgres is not reachable at /var/run/postgresql or localhost:5432." >&2
    else
      echo "Postgres is not reachable at localhost:5432." >&2
    fi
    echo "Run ./scripts/setupPostgresDev.sh to provision/start local dev Postgres, then retry." >&2
    exit 1
  fi
fi

pnpm --filter @tearleads/api exec tsx "$ROOT_DIR/packages/api/src/apiCli.ts" migrate "$@"
